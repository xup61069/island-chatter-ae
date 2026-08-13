cmake_minimum_required(VERSION 3.24)

project(IslandChatterNative VERSION 2.4.0 LANGUAGES CXX)

find_package(Threads REQUIRED)

option(ISLAND_CHATTER_BUILD_AE_PLUGIN "Build the After Effects .aex target" OFF)

if(MSVC)
    add_compile_options(/utf-8)
endif()

add_library(island_chatter_dsp STATIC
    src/analysis.cpp
    src/dsp.cpp
    src/midi.cpp
    src/song.cpp
    src/synthesis_cache.cpp
)
target_include_directories(island_chatter_dsp PUBLIC include)
target_include_directories(island_chatter_dsp PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_features(island_chatter_dsp PUBLIC cxx_std_17)
target_compile_definitions(island_chatter_dsp PRIVATE _USE_MATH_DEFINES)
if(MSVC)
    target_compile_options(island_chatter_dsp PRIVATE /W4 /permissive- /EHsc)
else()
    target_compile_options(island_chatter_dsp PRIVATE -Wall -Wextra -Wpedantic)
endif()

add_executable(island_chatter_native_tests tests/dsp_tests.cpp)
target_link_libraries(island_chatter_native_tests PRIVATE island_chatter_dsp Threads::Threads)

add_executable(island_chatter_midi_tests tests/midi_tests.cpp)
target_link_libraries(island_chatter_midi_tests PRIVATE island_chatter_dsp)

add_executable(island_chatter_song_tests tests/song_tests.cpp)
target_link_libraries(island_chatter_song_tests PRIVATE island_chatter_dsp)

add_executable(island_chatter_analysis_tests tests/analysis_tests.cpp)
target_link_libraries(island_chatter_analysis_tests PRIVATE island_chatter_dsp)

# The cloud voice, kept out of island_chatter_dsp on purpose: that library is
# what links into the .aex, and nothing that can open a socket belongs in the
# audio render path. Only island_chatter_voice and its tests see this.
add_library(island_chatter_cloud STATIC src/cloud.cpp)
target_include_directories(island_chatter_cloud PUBLIC include)
target_compile_features(island_chatter_cloud PUBLIC cxx_std_17)
if(MSVC)
    target_compile_options(island_chatter_cloud PRIVATE /W4 /permissive- /EHsc)
else()
    target_compile_options(island_chatter_cloud PRIVATE -Wall -Wextra -Wpedantic)
endif()

add_executable(island_chatter_cloud_tests tests/cloud_tests.cpp)
target_link_libraries(island_chatter_cloud_tests PRIVATE island_chatter_cloud)
# This suite is mostly about what gets refused, so it is the one test binary
# that catches exceptions and needs unwind semantics turned on.
if(MSVC)
    target_compile_options(island_chatter_cloud_tests PRIVATE /EHsc)
endif()

add_executable(island_chatter_render tools/render_preview.cpp)
target_link_libraries(island_chatter_render PRIVATE island_chatter_dsp)

# Ships next to the .aex so the panel's Bake command can render a WAV without
# involving the After Effects render queue.
add_executable(island_chatter_bake tools/bake_cli.cpp)
target_link_libraries(island_chatter_bake PRIVATE island_chatter_dsp)

# Ships beside the .aex as well. Windows only, and not because of a porting
# decision: the whole file is WinHTTP, which is the TLS stack ExtendScript does
# not have and the reason this tool exists at all.
if(WIN32)
    add_executable(island_chatter_voice tools/voice_cli.cpp)
    target_link_libraries(island_chatter_voice PRIVATE island_chatter_cloud winhttp)
    if(MSVC)
        target_compile_options(island_chatter_voice PRIVATE /W4 /permissive- /EHsc)
    endif()
endif()

# The offline model, 3.0.0. Referenced by path rather than vendored, exactly as
# the After Effects SDK is: sherpa-onnx ships prebuilt Windows x64 libraries and
# this repository has no business carrying 21 MB of somebody else's binaries.
# Point ISLAND_CHATTER_SHERPA_ROOT at an unpacked
# sherpa-onnx-vX.Y.Z-win-x64-shared-MD-Release-lib and the target appears.
set(ISLAND_CHATTER_SHERPA_ROOT "" CACHE PATH
    "Unpacked sherpa-onnx Windows x64 shared release (lib/ and include/)")
if(WIN32 AND ISLAND_CHATTER_SHERPA_ROOT)
    add_executable(island_chatter_local tools/local_cli.cpp)
    target_include_directories(island_chatter_local PRIVATE
        "${ISLAND_CHATTER_SHERPA_ROOT}/include")
    target_link_libraries(island_chatter_local PRIVATE
        island_chatter_cloud
        "${ISLAND_CHATTER_SHERPA_ROOT}/lib/sherpa-onnx-c-api.lib")
    if(MSVC)
        target_compile_options(island_chatter_local PRIVATE /W4 /permissive- /EHsc)
    endif()
    # The DLLs have to sit beside the executable, both here and once installed.
    add_custom_command(TARGET island_chatter_local POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${ISLAND_CHATTER_SHERPA_ROOT}/lib/sherpa-onnx-c-api.dll"
            "${ISLAND_CHATTER_SHERPA_ROOT}/lib/onnxruntime.dll"
            $<TARGET_FILE_DIR:island_chatter_local>
        VERBATIM)
endif()

enable_testing()
add_test(NAME island_chatter_native_tests COMMAND island_chatter_native_tests)
add_test(NAME island_chatter_midi_tests COMMAND island_chatter_midi_tests)
add_test(NAME island_chatter_song_tests COMMAND island_chatter_song_tests)
add_test(NAME island_chatter_analysis_tests COMMAND island_chatter_analysis_tests)
add_test(NAME island_chatter_cloud_tests COMMAND island_chatter_cloud_tests)

if(ISLAND_CHATTER_BUILD_AE_PLUGIN)
    include(cmake/VerifyAfterEffectsSdk.cmake)
    add_subdirectory(plugin)
endif()
