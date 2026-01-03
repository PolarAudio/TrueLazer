{
  "targets": [
    {
      "target_name": "ndi_wrapper",
      "sources": [ "src/ndi_wrapper.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "<(module_root_dir)/../sdk/NDI 6 SDK/Include"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": [ "/std:c++20" ]
        }
      },
      "conditions": [
        ['OS==\"win\"', {
          "libraries": [
            "<(module_root_dir)/../sdk/NDI 6 SDK/Libv6/x64/Processing.NDI.Lib.x64.lib"
          ],
          "copies": [
            {
              "destination": "<(PRODUCT_DIR)",
              "files": [
                "<(module_root_dir)/../sdk/NDI 6 SDK/Bin/x64/Processing.NDI.Lib.x64.dll"
              ]
            }
          ]
        }]
      ]
    }
  ]
}