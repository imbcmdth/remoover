REMOOVER
========

A tool to (poorly) attempt to fix corrupted/missing MOOV atoms in MP4 files!

Terminology
-----------

MDAT - A block of data that contains CHUNKS for one or more TRACKS.
TRACK - A single stream of one type of data. For example most MP4s have at least 2 tracks: a video track and an audio track.
CHUNK - A region of contiguous data in an MDAT containing one or more SAMPLES from a single TRACK.
SAMPLE - A block of data containing one or more elements that make up a single BITSTREAM. Where elements are "NAL units" for video and "ADTS frames" for audio.
BITSTREAM - The stream of data produced by a CODEC.
CODEC - A tool to make media smaller using magic.
