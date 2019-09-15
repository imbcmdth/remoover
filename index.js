#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const mp4Generator = require('./contrib/mp4-generator.js');
const { mdatMapper, mdatMapToSamples } = require('./lib/mdat-tools');
const {
  samplesToChunks,
  splitChunks,
  spreadAudioDurationToVideo,
  chunksToSTTS,
  chunksToSTSC,
  chunksToSTSZ,
  chunksToSTCO,
  chunksToSTSS,
  chunksToDuration,
  maxChunkOffset,
  shiftChunkOffsets,
} = require('./lib/chunk-tools');
const { copyRangeSync } = require('./lib/file-tools.js');
const {
  debug,
  time,
  prettyInt,
  prettyFloat,
  prettyBytes,
  stringLen,
  backspace,
} = require('./lib/formatting-tools.js');

const package = require('./package.json');
const program = require('commander');
 
program
  .version(package.version)
  .name('remoover')
  .usage("[options] <source file> [output file]")
  .option('-a, --he-aac', 'treat the source\'s audio as HE-AAC')
  .option('-d, --debug', 'enable the creation of debugging output files');
 
program.parse(process.argv);
global.DEBUG_LOGGING = program.debug;

if (!program.args[0] || !fs.existsSync(path.resolve(program.args[0]))) {
  console.error('You must supply a path to an existing video as the first parameter.');
  process.exit(2);
}

const inFilename = path.resolve(program.args[0]);
const inFd = fs.openSync(inFilename, 'r');

let outFilename;

const generateOutputFilename = (inFilname) => {
  let candidate = `${path.basename(inFilename, path.extname(inFilename))}.fixed.mp4`;
  let index = 1;
  while (fs.existsSync(path.resolve(candidate))) {
    candidate = `${path.basename(inFilename, path.extname(inFilename))}.fixed-${index++}.mp4`
  }
  return candidate;
};

if (program.args[1]) {
  outFilename = path.resolve(program.args[1]);
} else {
  outFilename = generateOutputFilename(inFilename);
}

// Scan file, gathering MDAT and sample info
// Build chunk-lists from samples
// Construct an moov
//   Generate chunk and sample tables
// Construct an FTYP box
// Copy MDATs to a start of new file
// Fixup MDAT lengths
// Append the new MOOV

const constructChunkList = (inFd, useHEAAC) => {
  const [mdatMap, mdatLocations, videoTrack, audioTrack] = time('MDAT mapping', () => mdatMapper(inFd, useHEAAC));

  console.log('MDATs found:', prettyInt(mdatLocations.length));
//  console.log('MDAT start(s) and end(s):');
//  mdatLocations.forEach(e => console.log(`  ${prettyInt(e.offset)} -> ${prettyInt(e.offset + e.length)}`));

  const samples = time('Building samples', () => mdatMapToSamples(mdatMap));
  console.log('Samples found:', prettyInt(samples.length));

  const [
    chunks,
    chunksDurations,
    chunksDurationsSplit,
  ] = time('Building chunks', () => {
    const chunks = samplesToChunks(samples);
    const chunksDurations = spreadAudioDurationToVideo(chunks);
    const chunksDurationsSplit = splitChunks(chunksDurations);

    return [
      chunks,
      chunksDurations,
      chunksDurationsSplit
    ];
  });

  debug(mdatMap);
  debug(samples, 'out_samples.json');
  debug(chunks, 'out_chunks.json');
  debug(chunksDurationsSplit, 'out_chunks_duration.json');

  return [videoTrack, audioTrack, chunksDurationsSplit, mdatLocations];
};

const constructTracks = (videoTrack, audioTrack, chunksDurationsSplit) => {
  time('Building sample table data', () => {
    //Start constructing actual stbl sub-box data
    videoTrack.STTS = chunksToSTTS(chunksDurationsSplit.video);
    audioTrack.STTS = chunksToSTTS(chunksDurationsSplit.audio);

    videoTrack.STSC = chunksToSTSC(chunksDurationsSplit.video);
    audioTrack.STSC = chunksToSTSC(chunksDurationsSplit.audio);

    videoTrack.STSZ = chunksToSTSZ(chunksDurationsSplit.video);
    audioTrack.STSZ = chunksToSTSZ(chunksDurationsSplit.audio);

    const maxVideoOffset = maxChunkOffset(chunksDurationsSplit.video);
    const maxAudioOffset = maxChunkOffset(chunksDurationsSplit.audio);

    if (maxVideoOffset >= 2**32) {
      console.log('Using 64-bit chunk offsets for video');
      videoTrack.CO64 = chunksToSTCO(chunksDurationsSplit.video);
    } else {
      videoTrack.STCO = chunksToSTCO(chunksDurationsSplit.video);
    }

    if (maxAudioOffset >= 2**32) {
      console.log('Using 64-bit chunk offsets for audio');
      audioTrack.CO64 = chunksToSTCO(chunksDurationsSplit.audio);
    } else {
      audioTrack.STCO = chunksToSTCO(chunksDurationsSplit.audio);
    }

    videoTrack.STSS = chunksToSTSS(chunksDurationsSplit.video);
  });


  videoTrack.duration = chunksToDuration(chunksDurationsSplit.video);
  audioTrack.duration = chunksToDuration(chunksDurationsSplit.audio);

  debug(videoTrack, 'out_avcc.json');
  debug(audioTrack, 'out_mp4a.json');

  return [videoTrack, audioTrack];
};

time('\nTotal time to reconstruct MP4', () => {
  // Open file for writing...
  const outFd = fs.openSync(outFilename, 'w');

  const [videoTrack, audioTrack, chunksDurationsSplit, mdatLocations] = constructChunkList(inFd, program.heAac);

  const ftyp = time('Generating ftyp', () => mp4Generator.ftyp());

  debug(ftyp, 'out_ftyp.bin', true);

  let outOffset = 0;
  time('Copying MDAT(s)', () => {
    // Write FTYP
    outOffset += fs.writeSync(outFd, ftyp, 0, ftyp.length, outOffset);

    // Copy each MDAT
    mdatLocations.forEach((e, i) => {
      const startTime = performance.now();
      const logString = `Copying MDAT #${i+1}: ${prettyBytes(e.length)}...`;
      process.stdout.write(logString);

      // Write MDAT length
      const mdatLength = Buffer.alloc(4);
      mdatLength.writeUInt32BE(e.length, 0);
      e.newOffset = outOffset;
      outOffset += fs.writeSync(outFd, mdatLength, 0, 4, outOffset);

      // Copy rest of the MDAT
      outOffset += copyRangeSync(inFd, outFd, e.offset + 4, e.length - 4, outOffset);

      const duration = (performance.now() - startTime) / 1000;
      const bytesPerSecond = e.length / duration;
      process.stdout.write(backspace(stringLen(logString)) + `Copied MDAT #${i+1}: ${prettyBytes(e.length)} @ ${prettyBytes(bytesPerSecond, '/s')}\n`);
    });
  });

  // Move all chunks and samples based on the new mdat locations
  const mdatOffsetShift = mdatLocations.map(e => e.newOffset - e.offset);

  shiftChunkOffsets(mdatOffsetShift, chunksDurationsSplit.video);
  shiftChunkOffsets(mdatOffsetShift, chunksDurationsSplit.audio);

  const tracks = constructTracks(videoTrack, audioTrack, chunksDurationsSplit);

  time('Generating MOOV', () => {
    const moov = mp4Generator.moov(tracks);
    debug(moov, 'out_moov.bin', true);
    // Write MOOV
    outOffset += fs.writeSync(outFd, moov, 0, moov.length, outOffset);
  });
  fs.closeSync(outFd);
});

fs.closeSync(inFd);
