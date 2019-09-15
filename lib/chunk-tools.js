const last = require('./last-array');

// In the comments and function names below, "samples" refers to either
// audio or video "frames". This is the raw offset and type information
// what we gathered from the MDAT

// Take an array of samples and group them into contiguous chunks where
// we can refer to the samples with a single "chunk offset"
const samplesToChunks = (samples) => {
  return samples.reduce((a, e) => {
    const lastChunk = last(a);
    if (!lastChunk ||
        (lastChunk.offset + lastChunk.length) !== e.offset ||
        lastChunk.mdatIndex !== e.mdatIndex ||
        lastChunk.type !== e.type) {
      a.push({
        type: e.type,
        offset: e.offset,
        length: e.length,
        duration: e.type === 'ADTS' ? e.duration : 0,
        mdatIndex: e.mdatIndex,
        samples: [e],
      });
    } else {
      lastChunk.length += e.length;
      lastChunk.duration += e.type === 'ADTS' ? e.duration : 0;
      lastChunk.samples.push(e);
    }
    return a;
  }, []);
};

// Split an array of chunks into individual groups based on their type
// We keep them together at first because it's easier that way in the
// "samplesToChunks" function
const splitChunks = (chunks) => {
  return {
    audio: chunks.filter(e => e.type === 'ADTS'),
    video: chunks.filter(e => e.type === 'AVCC'),
  };
};

// Only audio has duration information. Since the two interleaved, we "spread"
// the audio duration to the surrounding video frames to attempt to recover the
// video frame-rate.
const spreadAudioDurationToVideo = (chunks) => {
  let lastDuration = 0;
  return chunks.map(e => {
    const n = Object.assign({}, e);
    if (n.type === 'ADTS') {
      lastDuration += n.duration;
    } else {
      n.duration = lastDuration;
      const durationPerSample = Math.round(lastDuration / e.samples.length);
      n.samples = e.samples.map(es => {
        const ns = Object.assign({}, es);
        ns.duration = durationPerSample;
        return ns;
      });
      lastDuration = 0;
    }
    return n;
  });
};

// Convert the chunk data to a Time-to-Sample table
const chunksToSTTS = (chunks) => {
  return chunks.reduce((a, e) => {
    e.samples.forEach(es => {
      const lastChunk = last(a);
      if (!lastChunk || es.duration !== lastChunk.sampleDelta) {
        a.push({
          sampleCount: 1,
          sampleDelta: es.duration
        });
      } else {
        lastChunk.sampleCount += 1;
      }
    });
    return a;
  }, []);
};

// Convert the chunk data to a Sample-to-Chunk table
const chunksToSTSC = (chunks) => {
  return chunks.reduce((a, e, i) => {
    const lastChunk = last(a);
    if (!lastChunk || e.samples.length !== lastChunk.samplesPerChunk) {
      a.push({
        firstChunk: i + 1,
        samplesPerChunk: e.samples.length,
        sampleDescriptionIndex: 1,
      });
    }
    return a;
  }, []);
};

// Convert the chunk data to a Sample-siZe table
const chunksToSTSZ = (chunks) => {
  return chunks.reduce((a, e) => {
    e.samples.forEach(es => {
        a.push(es.length);
    });
    return a;
  }, []);
};

// Convert the chunk data to a Chunk-Offset table
const chunksToSTCO = (chunks) => {
  return chunks.reduce((a, e) => {
    a.push(e.offset);
    return a;
  }, []);
};

// Convert the chunk data to a Sync-Sample table
const chunksToSTSS = (chunks) => {
  let globalIndex = 0;
  return chunks.reduce((a, e) => {
    e.samples.forEach(es => {
      if (es.isSync) {
        a.push(globalIndex);
      }
      globalIndex++;
    });
    return a;
  }, []);
};

const chunksToDuration = (chunks) => chunks.reduce((a, e) => a + e.duration, 0);
const maxChunkOffset = (chunks) => chunks.reduce((m, e) => Math.max(m, e.offset), 0);

// Because we recreate the MP4 from scratch, the location of the MDATs may change
// To accomodate that, we have to shift the offsets in the chunks since they are
// relative to the start of the file.
const shiftChunkOffsets = (shiftArray, chunks) => {
  chunks.forEach((e) => {
    e.samples.forEach((es) => {
      es.offset += shiftArray[es.mdatIndex];
    });
    e.offset += shiftArray[e.mdatIndex];
  });
};

module.exports = {
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
};