const fs = require('fs');

// Size of a modern sector and common cluster size
const SECTOR_SIZE = 4096;
const CHUNK_MAX = SECTOR_SIZE * 1000;
const copyBuffer = Buffer.alloc(CHUNK_MAX);

// Copy a range of bytes from the input file to the output file
// Attempts to be smart about the whole thing:
//   1) Reads from sector-aligned chunks
//   2) Will not attempt to read past the end of the source file
const copyRangeSync = (inFd, outFd, srcStart, srcLength, dstStart) => {
  const { size: srcSize } = fs.fstatSync(inFd);
	let srcOffset = srcStart;
	let dstOffset = dstStart;
	let remaining = Math.min(srcLength, srcSize - srcOffset);
	let bytesWrite = 0;

	// First, align to SECTOR_SIZE boundaries
	let chunkSize = srcOffset % SECTOR_SIZE;
	if (chunkSize > 0) {
		bytesWrite += copyRangeDumbSync(inFd, outFd, srcOffset, chunkSize, dstOffset);
		srcOffset += chunkSize;
		dstOffset += chunkSize;
		remaining -= chunkSize;
	}

	while (remaining > 0) {
	  chunkSize = Math.min(CHUNK_MAX, remaining);

		bytesWrite += copyRangeDumbSync(inFd, outFd, srcOffset, chunkSize, dstOffset);

		srcOffset += chunkSize;
		dstOffset += chunkSize;
		remaining -= chunkSize;
	}

	return bytesWrite;
};

// Copy a range of bytes from the input file to the output file without doing
// any sort of range checking or alignment
const copyRangeDumbSync = (inFd, outFd, srcStart, srcLength, dstStart) => {
	const bytesRead = fs.readSync(inFd, copyBuffer, 0, srcLength, srcStart);
	const bytesWrite = fs.writeSync(outFd, copyBuffer, 0, bytesRead, dstStart);

	return bytesWrite;
};

module.exports = {
	copyRangeSync,
	copyRangeDumbSync,
};