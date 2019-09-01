const fs = require('fs');
const path = require('path');

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
} = require('./lib/chunk-tools');
const { copyRangeSync } = require('./lib/file-tools.js');

const program = require('commander');
 
program
  .option('-a, --he-aac', 'Treat the input audio as HE-AAC')
  .option('-d, --debug', 'Enable the creation of debug output files');
 
program.parse(process.argv);

if (!program.args[0] || !fs.existsSync(path.resolve(program.args[0]))) {
  console.error('You must supply a path to an existing as the first parameter.');
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

const debug = (obj, name = 'out.json', raw = false) => program.debug && fs.writeFileSync(name, raw ? obj : JSON.stringify(obj, null, '  '));

// Scan file, gathering MDAT and sample info
// Build chunk-lists from samples
// Construct an moov
//   Generate chunk and sample tables
// Construct an FTYP box
// Copy MDATs to a start of new file
// Fixup MDAT lengths
// Append the new MOOV

const constructChunkList = (inFd, useHEAAC) => {
  console.time('Mdat mapping');
  const [mdatMap, mdatLocations, videoTrack, audioTrack] = mdatMapper(inFd, useHEAAC);
  console.timeEnd('Mdat mapping');
  console.log('Total of', mdatLocations.length, 'mdats found.');
  console.log('Mdat start(s) and end(s):', mdatLocations.map(e => [e.offset, e.offset + e.length]));

  console.time('Building samples');
  const samples = mdatMapToSamples(mdatMap);
  console.timeEnd('Building samples');
  console.log('Samples found:', samples.length);

  console.time('Building chunks');
  const chunks = samplesToChunks(samples);
  const chunksDurations = spreadAudioDurationToVideo(chunks);
  const chunksDurationsSplit = splitChunks(chunksDurations);
  console.timeEnd('Building chunks');

  debug(mdatMap);
  debug(samples, 'out_samples.json');
  debug(chunks, 'out_chunks.json');
  debug(chunksDurationsSplit, 'out_chunks_duration.json');

  return [videoTrack, audioTrack, chunksDurationsSplit, mdatLocations];
};

const constructTracks = (videoTrack, audioTrack, chunksDurationsSplit) => {
  console.time('Building sample table data');
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
  console.timeEnd('Building sample table data');

  videoTrack.duration = chunksToDuration(chunksDurationsSplit.video);
  audioTrack.duration = chunksToDuration(chunksDurationsSplit.audio);

  debug(videoTrack, 'out_avcc.json');
  debug(audioTrack, 'out_mp4a.json');

  return [videoTrack, audioTrack];
};

const shiftChunkOffsets = (mdatOffsetShift, chunks) => {
  chunks.forEach((e) => {
    e.samples.forEach((es) => {
      es.offset += mdatOffsetShift[es.mdatIndex];
    });
    e.offset += mdatOffsetShift[e.mdatIndex];
  });
};

console.time('Completed reconstructing mp4 moov');

const [videoTrack, audioTrack, chunksDurationsSplit, mdatLocations] = constructChunkList(inFd, program.heAac);

console.time('Generating ftyp');
const ftyp = mp4Generator.ftyp();
console.timeEnd('Generating ftyp');

debug(ftyp, 'out_ftyp.bin', true);

console.time('Copying Mdat(s)');

const outFd = fs.openSync(outFilename, 'w');
let outOffset = 0;

// Write FTYP
outOffset += fs.writeSync(outFd, ftyp, 0, ftyp.length, outOffset);

// Copy each MDAT
mdatLocations.forEach(e => {
  const mdatLength = Buffer.alloc(4);
  mdatLength.writeUInt32BE(e.length, 0);
  e.newOffset = outOffset;
  outOffset += fs.writeSync(outFd, mdatLength, 0, 4, outOffset);
  outOffset += copyRangeSync(inFd, outFd, e.offset + 4, e.length - 4, outOffset);
});

// Copy file
//fs.copyFileSync(inFilename, outFilename, fs.constants.COPYFILE_EXCL);

console.timeEnd('Copying Mdat(s)');

// Move all chunks and samples based on the new mdat locations
const mdatOffsetShift = mdatLocations.map(e => e.newOffset - e.offset);

shiftChunkOffsets(mdatOffsetShift, chunksDurationsSplit.video);
shiftChunkOffsets(mdatOffsetShift, chunksDurationsSplit.audio);

const tracks = constructTracks(videoTrack, audioTrack, chunksDurationsSplit);

console.time('Generating moov');
const moov = mp4Generator.moov(tracks);
console.timeEnd('Generating moov');

debug(moov, 'out_moov.bin', true);

/*console.time('Patching mp4');
// Fix up mdat length(s)
mdatLocations.forEach(e => {
  const mdatLength = Buffer.alloc(4);
  mdatLength.writeUInt32BE(e.length, 0);
  fs.writeSync(outFd, mdatLength, 0, 4, e.offset);
});*/

// Append MOOV atom
//fs.writeSync(outFilename, moov);

// Write MOOV
outOffset += fs.writeSync(outFd, moov, 0, moov.length, outOffset);

//console.timeEnd('Patching mp4');

console.timeEnd('Completed reconstructing mp4 moov');
