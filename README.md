# REMOOVER

A tool to (poorly) attempt to fix corrupted/missing MOOV atoms in MP4 files!

## So what does this do?

This tool scans one or more MDAT(s) present in the MP4 and attempts to generate a "map" of all samples (currently only *AVCC formatted H.264* and *AAC within ADTS* are supported). With that "map" in hand, the tool then attempts to construct a valid MOOV (ignoring the existing MOOV, if present). Finally, the tool constructs a new, hopefully valid MP4, by copying **only** the MDAT(s) data into a new file and appends the new MOOV.

If all goes well, your corrupt unplayable MP4 becomes playable.

## Caveats and Limitations

There is a big caveat - audio might be slightly out of sync and frame rates might be a bit off for one or two frames. When an MP4 has a corrupted MOOV, the most important piece of information is missing: timing. This tool attempts to calculate the timing of frames by using the audio as a clock. Audio frames have a set duration so we can use the number of audio frames between groups of video frames to calculate the duration of those video frames.

As for limitations, the most important one is the format limitation mentioned above. But there is a second important limitation: Because we use the audio for guessing the timing for video frames, the two streams data must be interwoven. This is quite common for live streams but your results might vary for video sourced from a non-live source.

## Terminology

**BOX** - The fundamental structural unit of a standard MP4 container. See also: ATOM.

**ATOM** - The fundamental structural unit of a standard QuickTime container. See also: BOX.

**MDAT** - An BOX that contains CHUNKS for one or more TRACKS.

**TRACK** - A single stream of one type of data. For example most MP4s have at least 2 tracks: a video track and an audio track.

**CHUNK** - A region of contiguous data in an MDAT containing one or more SAMPLES from a single TRACK.

**SAMPLE** - A block of data containing one or more elements that make up a single BITSTREAM. Where elements are "NAL units" for video and "ADTS frames" for audio.

**BITSTREAM** - The stream of data produced by a CODEC.

**CODEC** - A tool to make media smaller using magic.

## License
```
Copyright (c) 2019, Jon-Carlos Rivera

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```
