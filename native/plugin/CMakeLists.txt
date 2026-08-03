set(_pipl_r "${CMAKE_CURRENT_SOURCE_DIR}/IslandChatterNativePiPL.r")
set(_pipl_rr "${CMAKE_CURRENT_BINARY_DIR}/IslandChatterNativePiPL.rr")
set(_pipl_rrc "${CMAKE_CURRENT_BINARY_DIR}/IslandChatterNativePiPL.rrc")
set(_pipl_rc "${CMAKE_CURRENT_BINARY_DIR}/IslandChatterNativePiPL.rc")

add_custom_command(
    OUTPUT "${_pipl_rc}"
    COMMAND "${CMAKE_COMMAND}"
        "-DSOURCE_FILE=${_pipl_r}"
        "-DHEADER_DIR=${AE_SDK_HEADERS}"
        "-DPIPL_TOOL=${AE_PIPL_TOOL}"
        "-DRR_FILE=${_pipl_rr}"
        "-DRRC_FILE=${_pipl_rrc}"
        "-DRC_FILE=${_pipl_rc}"
        -P "${CMAKE_CURRENT_SOURCE_DIR}/../cmake/GeneratePiPL.cmake"
    DEPENDS
        "${_pipl_r}"
        "${CMAKE_CURRENT_SOURCE_DIR}/IslandChatterVersion.h"
    VERBATIM
)

add_library(IslandChatterNative MODULE
    IslandChatterNative.cpp
    IslandChatterVersion.h
    params.hpp
    "${_pipl_rc}"
)
target_link_libraries(IslandChatterNative PRIVATE island_chatter_dsp)
target_include_directories(IslandChatterNative PRIVATE
    "${AE_SDK_HEADERS}"
    "${AE_SDK_HEADERS}/SP"
    "${AE_SDK_HEADERS}/Win"
    "${AE_SDK_RESOLVED_ROOT}/Examples/Resources"
    "${AE_SDK_RESOLVED_ROOT}/Examples/Util"
)
target_compile_definitions(IslandChatterNative PRIVATE
    MSWindows
    WIN32
    _WINDOWS
)
target_compile_features(IslandChatterNative PRIVATE cxx_std_17)
target_compile_options(IslandChatterNative PRIVATE /W4 /permissive- /EHsc)
set_target_properties(IslandChatterNative PROPERTIES
    PREFIX ""
    SUFFIX ".aex"
    OUTPUT_NAME "IslandChatterNative"
)
