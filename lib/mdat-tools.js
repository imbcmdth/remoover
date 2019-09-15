const fs = require('fs');

const last = require('./last-array');
const readSequenceParameterSet = require('../contrib/read-sps');
const {
  prettyFloat,
  stringLen,
  backspace,
} = require('../lib/formatting-tools');

// ADTS audio sample rate map
const frequencyMap = [
  96000,
  88200,
  64000,
  48000,
  44100,
  32000,
  24000,
  22050,
  16000,
  12000,
  11025,
  8000,
  7350,
  'Reserved',
  'Reserved',
  'Reserved',
];

// A list of top-level MP4 boxes or atoms. We need to use this to skip
// all  top-level boxes except for MDAT
const topLevelBoxes = [
  'mdat', // mdat has to be first for an easier "is it an mdat" check
  'ftyp',
  'pdin',
  'moov',
  'moof',
  'mfra',
  'free',
  'skip',
  'meta',
  'meco',
  'styp',
  'sidx',
  'ssix',
  'prft',
];

// Optimal representation of box names as a single unsigned integer
const topLevelBoxesUInt32 = topLevelBoxes.map(e => {
  return e.split('').reduce((a, c, i) => a + (c.charCodeAt(0) << ((3 - i) * 8)), 0);
});

// Since we can have more than one MDAT, we need to be able to keep
// of a table of offsets and lengths for each one
// This function helps us do that
const updateMdatLocation = (mdatLocations, lastMdatLocation, currentOffset, makeNewLocation = true) => {
  if (lastMdatLocation) {
    lastMdatLocation.length = currentOffset - lastMdatLocation.offset;
  }

  if (!makeNewLocation) {
    return null;
  }

  // Setup a new location object
  const newMdatLocation = {
    offset: currentOffset,
    length: 0,
  };
  mdatLocations.push(newMdatLocation);

  return newMdatLocation;
};

// This function has lots of responsibilities and should probably be
// split into more digestable pieces.
//
// Duty #1 - It walks through the MDAT looking for stream elements
//           categorizing them as either video (NAL) or audio (ADTS)
//           and keeping track of their locations in the MDAT
// Duty #2 - It has to watch out for new MDATs and record the location
//           and size of each MDAT it finds
// Duty #3 - It has to be able to skip over top-level boxes that aren't
//           mdats as it scans the file
// Duty #4 - It parses just enough data from the first SPS/PPS NAL units
//           and ADTS frame it stumbles across to allow us to construct
//           rudimentary "TRAK" atoms later
//
// Limitations:
//   1) It only supports AVCC-coded H.264 for video and ADTS packaged AAC
//      for audio

const mdatMapper = (inFd, useHEAAC = false) => {
  let videoTrack = {
    type: 'video',
    timescale: 100000,
    pps: null,
    sps: null,
  };
  let iterations = 0;
  let audioTrack = null;
  const mdatMap = [];
  const mdatLocations = [];
  let lastMdatLocation = null;

  const { size: fileSize } = fs.fstatSync(inFd);

  let currentOffset = 0;
  const probe = Buffer.alloc(8);

  // As we go through the mdat keep track of:
  // ...
  let percentScanned = prettyFloat(0, '%', true, 1);
  let amountWritten = stringLen(percentScanned);
  process.stdout.write(`Scanning MDAT data... ${percentScanned}`);

  while (true) {
    iterations++;
    const probeBytesRead = fs.readSync(inFd, probe, 0, 8, currentOffset);

    if (probeBytesRead < 8) {
      process.stdout.write(backspace(amountWritten) + 'done! \n');
      
      updateMdatLocation(mdatLocations, lastMdatLocation, currentOffset, false);
      return [mdatMap, mdatLocations, videoTrack, audioTrack];
    }

    let frameLength = 0;
    const maybeBoxName = probe.readUInt32BE(4);
    const topLevelBoxNameIndex = topLevelBoxesUInt32.indexOf(maybeBoxName);

    // Look for a probable ADTS frame... Obviously not perfect, but the odds that a single
    // element or box has a length so large that it starts with `0xFFF*` is pretty low
    if (probe[0] === 0xFF && (probe[1] === 0xF1 || probe[1] === 0xF0)) {
      frameLength = (probe[3] & 0x03 << 11) + (probe[4] << 3) + ((probe[5] & 0xE0) >> 5);
      let numberOfFrames = (probe[7] & 0x03) + 1;

      if (!audioTrack) {
        audioTrack = {
          type: 'audio',
          sampleCount: ((probe[6] & 0x03) + 1) * 1024,
          audioobjecttype: ((probe[2] >>> 6) & 0x03) + 1,
          channelcount: ((probe[2] & 0x01) << 2) | ((probe[3] & 0xC0) >>> 6),
          samplerate: frequencyMap[(probe[2] >> 2) & 0x0F],
          samplingfrequencyindex: (probe[2] >> 2) & 0x0F,
          samplesize: 16,
          timescale: 100000,
        };
      }

      if (lastMdatLocation === null) {
        // This can be true if the file is missing any mp4-structure and starts
        // right off with RAW mdat data
        lastMdatLocation = updateMdatLocation(mdatLocations, lastMdatLocation, currentOffset);
      }

      mdatMap.push({
        type: 'ADTS',
        offset: currentOffset,
        length: frameLength,
        duration: Math.round(1024 / audioTrack.samplerate * numberOfFrames * audioTrack.timescale / (useHEAAC ? 2  : 1)),
        mdatIndex: mdatLocations.length - 1,
      });
    } else if (topLevelBoxNameIndex === 0) {
      // Found a new MDAT!
      lastMdatLocation = updateMdatLocation(mdatLocations, lastMdatLocation, currentOffset);

      // Skip the MDAT header
      frameLength = 8;
    } else if (topLevelBoxNameIndex > 0) {
      // We found a top-level box that ISN'T an MDAT!

      // Update the lastMdatLocation but don't make a new one
      lastMdatLocation = updateMdatLocation(mdatLocations, lastMdatLocation, currentOffset, false);
      
      // Skip the entire box
      frameLength = probe.readUInt32BE(0);
    } else {
      // We have an AVCC nal unit...
      frameLength = probe.readUInt32BE(0) + 4;
      let nalId = probe[4];
      let nalUnitType;

      switch (nalId & 0x1F) {
      case 0x05:
        nalUnitType = 'slice_layer_without_partitioning_rbsp_idr';
        break;
      case 0x06:
        nalUnitType = 'sei_rbsp';
        break;
      case 0x07:
        nalUnitType = 'seq_parameter_set_rbsp';
        if (!videoTrack.sps) {
          const sps = Buffer.alloc(frameLength - 5);
          fs.readSync(inFd, sps, 0, frameLength - 5, currentOffset + 5);
          videoTrack.sps = [sps];
          Object.assign(videoTrack, readSequenceParameterSet(sps));
        }
        break;
      case 0x08:
        nalUnitType = 'pic_parameter_set_rbsp';
        if (!videoTrack.pps) {
          const pps = Buffer.alloc(frameLength - 5);
          fs.readSync(inFd, pps, 0, frameLength - 5, currentOffset + 5);
          videoTrack.pps = [pps];
        }
        break;
      case 0x09:
        nalUnitType = 'access_unit_delimiter_rbsp';
        break;

      default:
        nalUnitType = nalId
        break;
      }

      if (lastMdatLocation === null) {
        // This can be true if the file is missing any mp4-structure and starts
        // right off with RAW mdat data
        lastMdatLocation = updateMdatLocation(mdatLocations, lastMdatLocation, currentOffset);
      }

      mdatMap.push({
        type: 'NAL',
        offset: currentOffset,
        length: frameLength,
        nalUnitType,
        mdatIndex: mdatLocations.length - 1,
      });
    }

    if (iterations % 2000 === 0) {
      percentScanned = prettyFloat(currentOffset / fileSize * 100, '%', true, 1);
      amountWritten = stringLen(percentScanned);
      process.stdout.write(backspace(amountWritten) + percentScanned);
    }

    // Skip the current frame, nal unit, or box's length clamping
    // to file size so we don't attempt to run past the end when
    // dealing with truncated elements or boxes
    currentOffset = Math.min(currentOffset + frameLength, fileSize);
  }
};

// Converts the mdat-map of raw elements into samples
// In other words, it groups the individual NAL Units we found into
// single samples or "frames". This is only important for video
// because audio is already in "frames" from the start.
const mdatMapToSamples = (mdatMap) => {
  return mdatMap.reduce((a, e) => {
    // ADTS packets are already single-samples so pass them through unchanged
    if (e.type === 'ADTS') {
      a.push(e);
      return a;
    }

    const lastSample = last(a);
    if (e.nalUnitType === 'access_unit_delimiter_rbsp') {
      // When we find an AUD, we know that we have a new frame so generate a new sample
      a.push({
        type: 'AVCC',
        offset: e.offset,
        length: e.length,
        mdatIndex: e.mdatIndex,
      });
    } else if (lastSample && lastSample.type === 'AVCC') {
      // Otherwise, concat this NAL unit into the existing frame
      if (e.nalUnitType === 'slice_layer_without_partitioning_rbsp_idr') {
        // If this nal unit is an i-frame, then mark it as a sync-point for later
        lastSample.isSync = true;
      }
      lastSample.length += e.length;
    } else {
      // Otherwise, drop this nal unit...
    }
    return a;
  }, []);
};

module.exports = {
  mdatMapper,
  mdatMapToSamples
};