#include <napi.h>
#include <Processing.NDI.Lib.h>
#include <vector>
#include <string>

class NdiWrapper : public Napi::ObjectWrap<NdiWrapper> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "NdiWrapper", {
            InstanceMethod("initialize", &NdiWrapper::Initialize),
            InstanceMethod("findSources", &NdiWrapper::FindSources),
            InstanceMethod("createReceiver", &NdiWrapper::CreateReceiver),
            InstanceMethod("captureVideo", &NdiWrapper::CaptureVideo),
            InstanceMethod("destroyReceiver", &NdiWrapper::DestroyReceiver)
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
    }

    ~NdiWrapper() {
        if (p_find) NDIlib_find_destroy(p_find);
        if (p_recv) NDIlib_recv_destroy(p_recv);
        NDIlib_destroy();
    }

private:
    NDIlib_find_instance_t p_find;
    NDIlib_recv_instance_t p_recv;

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

    Napi::Value CaptureVideo(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (!p_recv) return env.Null();

        // Optional parameters for downsampling
        uint32_t target_width = 0;
        uint32_t target_height = 0;
        if (info.Length() >= 2 && info[0].IsNumber() && info[1].IsNumber()) {
            target_width = info[0].As<Napi::Number>().Uint32Value();
            target_height = info[1].As<Napi::Number>().Uint32Value();
        }

        NDIlib_video_frame_v2_t video_frame;
        NDIlib_frame_type_e frame_type = NDIlib_recv_capture_v2(p_recv, &video_frame, nullptr, nullptr, 10);

        if (frame_type == NDIlib_frame_type_video) {
            Napi::Object obj = Napi::Object::New(env);
            
            if (target_width > 0 && target_height > 0 && (video_frame.xres != (int)target_width || video_frame.yres != (int)target_height)) {
                // Perform simple nearest-neighbor downsampling
                size_t out_size = target_width * target_height * 4;
                uint8_t* out_data = (uint8_t*)malloc(out_size);
                
                float scale_x = (float)video_frame.xres / target_width;
                float scale_y = (float)video_frame.yres / target_height;

                for (uint32_t y = 0; y < target_height; y++) {
                    for (uint32_t x = 0; x < target_width; x++) {
                        int src_x = (int)(x * scale_x);
                        int src_y = (int)(y * scale_y);
                        uint32_t src_idx = src_y * video_frame.line_stride_in_bytes + src_x * 4;
                        uint32_t dst_idx = (y * target_width + x) * 4;
                        
                        out_data[dst_idx] = video_frame.p_data[src_idx];
                        out_data[dst_idx + 1] = video_frame.p_data[src_idx + 1];
                        out_data[dst_idx + 2] = video_frame.p_data[src_idx + 2];
                        out_data[dst_idx + 3] = video_frame.p_data[src_idx + 3];
                    }
                }

                obj.Set("width", Napi::Number::New(env, target_width));
                obj.Set("height", Napi::Number::New(env, target_height));
                
                Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::Copy(env, out_data, out_size);
                free(out_data);
                obj.Set("data", buffer);
            } else {
                // No downsampling requested or already correct size
                obj.Set("width", Napi::Number::New(env, video_frame.xres));
                obj.Set("height", Napi::Number::New(env, video_frame.yres));
                size_t size = video_frame.xres * video_frame.yres * 4;
                obj.Set("data", Napi::Buffer<uint8_t>::Copy(env, video_frame.p_data, size));
            }

            NDIlib_recv_free_video_v2(p_recv, &video_frame);
            return obj;
        }

        return env.Null();
    }

    Napi::Value DestroyReceiver(const Napi::CallbackInfo& info) {
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
