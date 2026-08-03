if(NOT DEFINED AE_SDK_ROOT OR AE_SDK_ROOT STREQUAL "")
    message(FATAL_ERROR
        "AE_SDK_ROOT is required. Download and extract the official After Effects SDK, "
        "then pass -DAE_SDK_ROOT=C:/path/to/AfterEffectsSDK")
endif()

file(TO_CMAKE_PATH "${AE_SDK_ROOT}" AE_SDK_ROOT)

set(_header_candidates
    "${AE_SDK_ROOT}/Examples/Headers/AE_Effect.h"
    "${AE_SDK_ROOT}/Headers/AE_Effect.h"
)
file(GLOB _nested_headers "${AE_SDK_ROOT}/*/Examples/Headers/AE_Effect.h")
list(APPEND _header_candidates ${_nested_headers})

set(AE_SDK_HEADERS "")
foreach(_header IN LISTS _header_candidates)
    if(EXISTS "${_header}")
        get_filename_component(AE_SDK_HEADERS "${_header}" DIRECTORY)
        break()
    endif()
endforeach()

if(AE_SDK_HEADERS STREQUAL "")
    message(FATAL_ERROR
        "AE_Effect.h was not found below AE_SDK_ROOT='${AE_SDK_ROOT}'. "
        "Point AE_SDK_ROOT at the extracted After Effects SDK directory.")
endif()

get_filename_component(_sdk_examples_dir "${AE_SDK_HEADERS}" DIRECTORY)
get_filename_component(AE_SDK_RESOLVED_ROOT "${_sdk_examples_dir}" DIRECTORY)

set(_pipl_candidates
    "${AE_SDK_ROOT}/Examples/Resources/PiPLtool.exe"
    "${AE_SDK_ROOT}/Examples/Resources/PiPLTool.exe"
    "${AE_SDK_ROOT}/Resources/PiPLtool.exe"
    "${AE_SDK_ROOT}/Resources/PiPLTool.exe"
)
file(GLOB _nested_pipl_tools
    "${AE_SDK_ROOT}/*/Examples/Resources/PiPLtool.exe"
    "${AE_SDK_ROOT}/*/Examples/Resources/PiPLTool.exe")
list(APPEND _pipl_candidates ${_nested_pipl_tools})

set(AE_PIPL_TOOL "")
foreach(_tool IN LISTS _pipl_candidates)
    if(EXISTS "${_tool}")
        set(AE_PIPL_TOOL "${_tool}")
        break()
    endif()
endforeach()

if(AE_PIPL_TOOL STREQUAL "")
    message(FATAL_ERROR
        "PiPLTool.exe was not found in the SDK. Use the complete Windows After Effects SDK package.")
endif()

message(STATUS "After Effects SDK headers: ${AE_SDK_HEADERS}")
message(STATUS "After Effects PiPL tool: ${AE_PIPL_TOOL}")
message(STATUS "After Effects SDK root: ${AE_SDK_RESOLVED_ROOT}")
