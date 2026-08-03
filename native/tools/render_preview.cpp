#include "island_chatter/dsp.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {

void write_u16(std::ofstream& output, std::uint16_t value) {
    output.put(static_cast<char>(value & 0xFFU));
    output.put(static_cast<char>((value >> 8U) & 0xFFU));
}

void write_u32(std::ofstream& output, std::uint32_t value) {
    for (int shift = 0; shift < 32; shift += 8) {
        output.put(static_cast<char>((value >> shift) & 0xFFU));
    }
}

void write_wav(const std::string& path, const island_chatter::Result& result, std::uint32_t sample_rate) {
    std::ofstream output(path, std::ios::binary);
    if (!output) {
        throw std::runtime_error("cannot open output WAV");
    }
    const auto data_bytes = static_cast<std::uint32_t>(result.samples.size() * 2U);
    output.write("RIFF", 4);
    write_u32(output, 36U + data_bytes);
    output.write("WAVEfmt ", 8);
    write_u32(output, 16U);
    write_u16(output, 1U);
    write_u16(output, 1U);
    write_u32(output, sample_rate);
    write_u32(output, sample_rate * 2U);
    write_u16(output, 2U);
    write_u16(output, 16U);
    output.write("data", 4);
    write_u32(output, data_bytes);
    for (const float sample : result.samples) {
        const auto pcm = static_cast<std::int16_t>(std::lround(
            std::clamp(sample, -1.0F, 1.0F) * 32767.0F));
        write_u16(output, static_cast<std::uint16_t>(pcm));
    }
}

}  // namespace

int main(int argc, char** argv) {
    island_chatter::Settings settings;
    settings.text = argc > 2 ? argv[2] : "你好，歡迎來到小島！今天想一起去海邊散步嗎？";
    settings.consonant = 1.25;
    settings.speed = 0.94;
    const std::string path = argc > 1 ? argv[1] : "native-preview.wav";
    const auto result = island_chatter::synthesize(settings);
    write_wav(path, result, settings.sample_rate);
    std::cout << "Rendered " << result.diagnostics.duration_seconds << "s to " << path
              << " (peak " << result.diagnostics.peak << ")\n";
    return 0;
}
