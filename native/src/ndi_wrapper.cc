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
        p_find = nullptr;
        p_recv = nullptr;
        stop_thread = true;
        
        write_idx = 0;
        read_idx = -1;
        new_frame_available = false;
        
        frame_width = 0;
        frame_height = 0;
        target_width = 1280;
        target_height = 720;

        for (int i = 0; i < 3; i++) {
            buffers[i].reserve(1920 * 1080 * 4);
        }
    }

    ~NdiWrapper() {
        StopCaptureInternal();
        if (p_find) NDIlib_find_destroy(p_find);
        if (p_recv) NDIlib_recv_destroy(p_recv);
        NDIlib_destroy();
    }

private:
    NDIlib_find_instance_t p_find;
    NDIlib_recv_instance_t p_recv;

    std::thread capture_thread;
    std::atomic<bool> stop_thread;
    
    std::vector<uint8_t> buffers[3];
    int write_idx;
    std::atomic<int> read_idx;
    std::atomic<bool> new_frame_available;
    
    int frame_width;
    int frame_height;
    std::atomic<int> target_width;
    std::atomic<int> target_height;

    void StopCaptureInternal() {
        stop_thread = true;
        if (capture_thread.joinable()) {
            capture_thread.join();
        }
    }

    void CaptureLoop() {
        while (!stop_thread) {
            if (!p_recv) {
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
                continue;
            }

            NDIlib_video_frame_v2_t video_frame;
            NDIlib_frame_type_e frame_type = NDIlib_recv_capture_v2(p_recv, &video_frame, nullptr, nullptr, 100);

            if (frame_type == NDIlib_frame_type_video) {
                int tw = target_width.load();
                int th = target_height.load();

                int next_write_idx = (write_idx + 1) % 3;
                if (next_write_idx == read_idx.load()) {
                    next_write_idx = (next_write_idx + 1) % 3;
                }

                std::vector<uint8_t>& current_buffer = buffers[next_write_idx];
                
                if (tw > 0 && th > 0 && (video_frame.xres != tw || video_frame.yres != th)) {
                    current_buffer.resize(tw * th * 4);
                    float scale_x = (float)video_frame.xres / tw;
                    float scale_y = (float)video_frame.yres / th;

                    uint32_t* dst_ptr = (uint32_t*)current_buffer.data();
                    const uint8_t* src_data = video_frame.p_data;
                    int line_stride = video_frame.line_stride_in_bytes;

                    for (int y = 0; y < th; y++) {
                        const uint32_t* src_row = (const uint32_t*)(src_data + (int)(y * scale_y) * line_stride);
                        for (int x = 0; x < tw; x++) {
                            dst_ptr[y * tw + x] = src_row[(int)(x * scale_x)];
                        }
                    }
                    frame_width = tw;
                    frame_height = th;
                } else {
                    size_t size = video_frame.xres * video_frame.yres * 4;
                    current_buffer.assign(video_frame.p_data, video_frame.p_data + size);
                    frame_width = video_frame.xres;
                    frame_height = video_frame.yres;
                }
                
                write_idx = next_write_idx;
                read_idx.store(next_write_idx);
                new_frame_available = true;

                NDIlib_recv_free_video_v2(p_recv, &video_frame);
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
        if (!p_find) {
            p_find = NDIlib_find_create_v2();
        }

        uint32_t num_sources = 0;
        const NDIlib_source_t* p_sources = NDIlib_find_get_current_sources(p_find, &num_sources);

        Napi::Array result = Napi::Array::New(env, num_sources);
        for (uint32_t i = 0; i < num_sources; i++) {
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

        if (p_recv) {
            NDIlib_recv_destroy(p_recv);
            p_recv = nullptr;
        }

        NDIlib_source_t source;
        source.p_ndi_name = source_name.c_str();

        NDIlib_recv_create_v3_t recv_create_desc;
        recv_create_desc.source_to_connect_to = source;
        recv_create_desc.color_format = NDIlib_recv_color_format_BGRX_BGRA;
        recv_create_desc.bandwidth = NDIlib_recv_bandwidth_highest;
        recv_create_desc.allow_video_fields = false;

        p_recv = NDIlib_recv_create_v3(&recv_create_desc);
        
        return Napi::Boolean::New(env, p_recv != nullptr);
    }

    Napi::Value StartCapture(const Napi::CallbackInfo& info) {
        if (!p_recv) return Napi::Boolean::New(info.Env(), false);
        
        if (info.Length() >= 2 && info[0].IsNumber() && info[1].IsNumber()) {
            target_width = info[0].As<Napi::Number>().Int32Value();
            target_height = info[1].As<Napi::Number>().Int32Value();
        }

        if (stop_thread) {
            stop_thread = false;
            capture_thread = std::thread(&NdiWrapper::CaptureLoop, this);
        }
        return Napi::Boolean::New(info.Env(), true);
    }

    Napi::Value StopCapture(const Napi::CallbackInfo& info) {
        StopCaptureInternal();
        return info.Env().Undefined();
    }

    Napi::Value CaptureVideo(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (!new_frame_available.load()) return env.Null();

        int current_read_idx = read_idx.load();
        if (current_read_idx < 0) return env.Null();

        std::vector<uint8_t>& buffer = buffers[current_read_idx];
        
        Napi::Object obj = Napi::Object::New(env);
        obj.Set("width", Napi::Number::New(env, frame_width));
        obj.Set("height", Napi::Number::New(env, frame_height));
        obj.Set("data", Napi::Buffer<uint8_t>::Copy(env, buffer.data(), buffer.size()));
        
        new_frame_available = false;
        return obj;
    }

    Napi::Value DestroyReceiver(const Napi::CallbackInfo& info) {
        StopCaptureInternal();
        if (p_recv) {
            NDIlib_recv_destroy(p_recv);
            p_recv = nullptr;
        }
        return info.Env().Undefined();
    }
};

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
    return NdiWrapper::Init(env, exports);
}

NODE_API_MODULE(ndi_wrapper, InitAll)
