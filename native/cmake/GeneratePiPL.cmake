foreach(_required IN ITEMS SOURCE_FILE HEADER_DIR PIPL_TOOL RR_FILE RRC_FILE RC_FILE)
    if(NOT DEFINED ${_required})
        message(FATAL_ERROR "GeneratePiPL.cmake requires ${_required}")
    endif()
endforeach()

execute_process(
    COMMAND cl /nologo /I "${HEADER_DIR}" /EP "${SOURCE_FILE}"
    OUTPUT_FILE "${RR_FILE}"
    RESULT_VARIABLE _preprocess_result
)
if(NOT _preprocess_result EQUAL 0)
    message(FATAL_ERROR "Failed to preprocess PiPL source (${_preprocess_result})")
endif()

execute_process(
    COMMAND "${PIPL_TOOL}" "${RR_FILE}" "${RRC_FILE}"
    RESULT_VARIABLE _pipl_result
)
if(NOT _pipl_result EQUAL 0)
    message(FATAL_ERROR "PiPLTool failed (${_pipl_result})")
endif()

execute_process(
    COMMAND cl /nologo /D MSWindows /EP "${RRC_FILE}"
    OUTPUT_FILE "${RC_FILE}"
    RESULT_VARIABLE _resource_result
)
if(NOT _resource_result EQUAL 0)
    message(FATAL_ERROR "Failed to generate Windows PiPL resource (${_resource_result})")
endif()
