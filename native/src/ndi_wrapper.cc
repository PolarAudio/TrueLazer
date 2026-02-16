#include <napi.h>
#include <Processing.NDI.Lib.h>
#include <vector>
#include <string>
#include <thread>
#include <mutex>
#include <atomic>
#include <condition_variable>
#include <iostream>

class NdiWrapper : public Napi::ObjectWrap<NdiWrapper> {
 public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "NdiWrapper", {
      InstanceMethod("initialize", &NdiWrapper::Initialize),
      InstanceMethod("findSources", &NdiWrapper::FindSources),
      InstanceMethod("createReceiver", &NdiWrapper::CreateReceiver),
      InstanceMethod("captureVideo", &NdiWrapper::CaptureVideo),
      InstanceMethod("destroyReceiver", &NdiWrapper::DestroyReceiver),
      InstanceMethod("startCapture", &NdiWrapper::StartCapture),
      InstanceMethod("stopCapture", &NdiWrapper::StopCapture)
    });

    Napi::FunctionReference* constructor = new Napi::FunctionReference();
    *constructor = Napi::Persistent(func);
    env.SetInstanceData(constructor);

    exports.Set("NdiWrapper", func);
    return exports;
  }

  NdiWrapper(const Napi::CallbackInfo& info) : Napi::ObjectWrap<NdiWrapper>(info) {
    p_find_ = nullptr;
    p_recv_ = nullptr;
    stop_thread_ = true;
    
    write_idx_ = 0;
    read_idx_ = -1;
    new_frame_available_ = false;
    
    frame_width_ = 0;
    frame_height_ = 0;
    target_width_ = 480;
    target_height_ = 480;

    for (int i = 0; i < 3; ++i) {
      buffers_[i].reserve(1920 * 1080 * 4);
    }
  }

  ~NdiWrapper() {
    StopCaptureInternal();
    if (p_find_) NDIlib_find_destroy(p_find_);
    if (p_recv_) NDIlib_recv_destroy(p_recv_);
    NDIlib_destroy();
  }

 private:
  NDIlib_find_instance_t p_find_;
  NDIlib_recv_instance_t p_recv_;

  std::thread capture_thread_;
  std::atomic<bool> stop_thread_;
  
  std::mutex buffer_mutex_;
  std::vector<uint8_t> buffers_[3];
  int write_idx_;
  std::atomic<int> read_idx_;
  std::atomic<bool> new_frame_available_;
  
  int frame_width_;
  int frame_height_;
  std::atomic<int> target_width_;
  std::atomic<int> target_height_;

  void StopCaptureInternal() {
    stop_thread_ = true;
    if (capture_thread_.joinable()) {
      capture_thread_.join();
    }
  }

  void CaptureLoop() {
    while (!stop_thread_) {
      if (!p_recv_) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        continue;
      }

      NDIlib_video_frame_v2_t video_frame;
      NDIlib_frame_type_e frame_type = NDIlib_recv_capture_v2(p_recv_, &video_frame, nullptr, nullptr, 100);

      if (frame_type == NDIlib_frame_type_video) {
        int tw = target_width_.load();
        int th = target_height_.load();

        int next_write_idx = (write_idx_ + 1) % 3;
        if (next_write_idx == read_idx_.load()) {
          next_write_idx = (next_write_idx + 1) % 3;
        }

        {
          std::lock_guard<std::mutex> lock(buffer_mutex_);
          std::vector<uint8_t>& current_buffer = buffers_[next_write_idx];
          
          if (tw > 0 && th > 0 && (video_frame.xres != tw || video_frame.yres != th)) {
            current_buffer.resize(tw * th * 4);
            float scale_x = static_cast<float>(video_frame.xres) / tw;
            float scale_y = static_cast<float>(video_frame.yres) / th;

            uint32_t* dst_ptr = reinterpret_cast<uint32_t*>(current_buffer.data());
            const uint8_t* src_data = video_frame.p_data;
            int line_stride = video_frame.line_stride_in_bytes;

            for (int y = 0; y < th; ++y) {
              const uint32_t* src_row = reinterpret_cast<const uint32_t*>(src_data + static_cast<int>(y * scale_y) * line_stride);
              for (int x = 0; x < tw; ++x) {
                dst_ptr[y * tw + x] = src_row[static_cast<int>(x * scale_x)];
              }
            }
            frame_width_ = tw;
            frame_height_ = th;
          } else {
            size_t size = video_frame.xres * video_frame.yres * 4;
            current_buffer.assign(video_frame.p_data, video_frame.p_data + size);
            frame_width_ = video_frame.xres;
            frame_height_ = video_frame.yres;
          }
          
          write_idx_ = next_write_idx;
          read_idx_.store(next_write_idx);
          new_frame_available_ = true;
        }

        NDIlib_recv_free_video_v2(p_recv_, &video_frame);
      } else if (frame_type == NDIlib_frame_type_error) {
        break;
      }
    }
  }

  Napi::Value Initialize(const Napi::CallbackInfo& info) {
    bool success = NDIlib_initialize();
    return Napi::Boolean::New(info.Env(), success);
  }

  Napi::Value FindSources(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!p_find_) {
      p_find_ = NDIlib_find_create_v2();
    }

    uint32_t num_sources = 0;
    const NDIlib_source_t* p_sources = NDIlib_find_get_current_sources(p_find_, &num_sources);

    Napi::Array result = Napi::Array::New(env, num_sources);
    for (uint32_t i = 0; i < num_sources; ++i) {
      Napi::Object obj = Napi::Object::New(env);
      obj.Set("name", Napi::String::New(env, p_sources[i].p_ndi_name));
      result.Set(i, obj);
    }
    return result;
  }

  Napi::Value CreateReceiver(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
      Napi::TypeError::New(env, "String source name expected").ThrowAsJavaScriptException();
      return env.Null();
    }

    std::string source_name = info[0].As<Napi::String>().Utf8Value();

    StopCaptureInternal();

    if (p_recv_) {
      NDIlib_recv_destroy(p_recv_);
      p_recv_ = nullptr;
    }

    NDIlib_source_t source;
    source.p_ndi_name = source_name.c_str();

    NDIlib_recv_create_v3_t recv_create_desc;
    recv_create_desc.source_to_connect_to = source;
    recv_create_desc.color_format = NDIlib_recv_color_format_BGRX_BGRA;
    recv_create_desc.bandwidth = NDIlib_recv_bandwidth_highest;
    recv_create_desc.allow_video_fields = false;

    p_recv_ = NDIlib_recv_create_v3(&recv_create_desc);
    
    return Napi::Boolean::New(env, p_recv_ != nullptr);
  }

  Napi::Value StartCapture(const Napi::CallbackInfo& info) {
    if (!p_recv_) return Napi::Boolean::New(info.Env(), false);
    
    if (info.Length() >= 2 && info[0].IsNumber() && info[1].IsNumber()) {
      target_width_ = info[0].As<Napi::Number>().Int32Value();
      target_height_ = info[1].As<Napi::Number>().Int32Value();
    }

    if (stop_thread_) {
      stop_thread_ = false;
      capture_thread_ = std::thread(&NdiWrapper::CaptureLoop, this);
    }
    return Napi::Boolean::New(info.Env(), true);
  }

  Napi::Value StopCapture(const Napi::CallbackInfo& info) {
    StopCaptureInternal();
    return info.Env().Undefined();
  }

  Napi::Value CaptureVideo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!new_frame_available_.load()) return env.Null();

    int current_read_idx = read_idx_.load();
    if (current_read_idx < 0) return env.Null();

    Napi::Object obj = Napi::Object::New(env);
    
    {
      std::lock_guard<std::mutex> lock(buffer_mutex_);
      std::vector<uint8_t>& buffer = buffers_[current_read_idx];
      obj.Set("width", Napi::Number::New(env, frame_width_));
      obj.Set("height", Napi::Number::New(env, frame_height_));
      obj.Set("data", Napi::Buffer<uint8_t>::Copy(env, buffer.data(), buffer.size()));
    }
    
    new_frame_available_ = false;
    return obj;
  }

  Napi::Value DestroyReceiver(const Napi::CallbackInfo& info) {
    StopCaptureInternal();
    if (p_recv_) {
      NDIlib_recv_destroy(p_recv_);
      p_recv_ = nullptr;
    }
    return info.Env().Undefined();
  }
};

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  return NdiWrapper::Init(env, exports);
}

NODE_API_MODULE(ndi_wrapper, InitAll)
