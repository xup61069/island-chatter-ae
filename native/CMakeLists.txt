cmake_minimum_required(VERSION 3.24)

project(IslandChatterNative VERSION 1.9.0 LANGUAGES CXX)

find_package(Threads REQUIRED)

option(ISLAND_CHATTER_BUILD_AE_PLUGIN "Build the After Effects .aex target" OFF)

if(MSVC)
    add_compile_options(/utf-8)
endif()

add_library(island_chatter_dsp STATIC
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

add_executable(island_chatter_render tools/render_preview.cpp)
target_link_libraries(island_chatter_render PRIVATE island_chatter_dsp)

# Ships next to the .aex so the panel's Bake command can render a WAV without
# involving the After Effects render queue.
add_executable(island_chatter_bake tools/bake_cli.cpp)
target_link_libraries(island_chatter_bake PRIVATE island_chatter_dsp)

enable_testing()
add_test(NAME island_chatter_native_tests COMMAND island_chatter_native_tests)
add_test(NAME island_chatter_midi_tests COMMAND island_chatter_midi_tests)
add_test(NAME island_chatter_song_tests COMMAND island_chatter_song_tests)

if(ISLAND_CHATTER_BUILD_AE_PLUGIN)
    include(cmake/VerifyAfterEffectsSdk.cmake)
    add_subdirectory(plugin)
endif()
