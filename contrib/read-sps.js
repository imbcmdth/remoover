/******************************************************************************
  Copyright Brightcove, Inc.

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
******************************************************************************/

const ExpGolomb = require('./exp-golomb.js');

// values of profile_idc that indicate additional fields are included in the SPS
// see Recommendation ITU-T H.264 (4/2013),
// 7.3.2.1.1 Sequence parameter set data syntax
const PROFILES_WITH_OPTIONAL_SPS_DATA = {
  100: true,
  110: true,
  122: true,
  244: true,
  44: true,
  83: true,
  86: true,
  118: true,
  128: true,
  138: true,
  139: true,
  134: true
};

/**
 * Read a sequence parameter set and return some interesting video
 * properties. A sequence parameter set is the H264 metadata that
 * describes the properties of upcoming video frames.
 * @param data {Uint8Array} the bytes of a sequence parameter set
 * @return {object} an object with configuration parsed from the
 * sequence parameter set, including the dimensions of the
 * associated video frames.
 */
const readSequenceParameterSet = (data) => {
  let frameCropLeftOffset = 0;
  let frameCropRightOffset = 0;
  let frameCropTopOffset = 0;
  let frameCropBottomOffset = 0;
  let sarScale = 1;
  let chromaFormatIdc, picOrderCntType;
  let numRefFramesInPicOrderCntCycle, picWidthInMbsMinus1;
  let picHeightInMapUnitsMinus1;
  let frameMbsOnlyFlag;
  let scalingListCount;
  let sarRatio;
  let aspectRatioIdc;
  let i;

  let expGolombDecoder = new ExpGolomb(data);
  let profileIdc = expGolombDecoder.readUnsignedByte(); // profile_idc
  let profileCompatibility = expGolombDecoder.readUnsignedByte(); // constraint_set[0-5]_flag
  let levelIdc = expGolombDecoder.readUnsignedByte(); // level_idc u(8)
  expGolombDecoder.skipUnsignedExpGolomb(); // seq_parameter_set_id

  // some profiles have more optional data we don't need
  if (PROFILES_WITH_OPTIONAL_SPS_DATA[profileIdc]) {
    chromaFormatIdc = expGolombDecoder.readUnsignedExpGolomb();
    if (chromaFormatIdc === 3) {
      expGolombDecoder.skipBits(1); // separate_colour_plane_flag
    }
    expGolombDecoder.skipUnsignedExpGolomb(); // bit_depth_luma_minus8
    expGolombDecoder.skipUnsignedExpGolomb(); // bit_depth_chroma_minus8
    expGolombDecoder.skipBits(1); // qpprime_y_zero_transform_bypass_flag
    if (expGolombDecoder.readBoolean()) { // seq_scaling_matrix_present_flag
      scalingListCount = (chromaFormatIdc !== 3) ? 8 : 12;
      for (i = 0; i < scalingListCount; i++) {
        if (expGolombDecoder.readBoolean()) { // seq_scaling_list_present_flag[ i ]
          if (i < 6) {
            skipScalingList(16, expGolombDecoder);
          } else {
            skipScalingList(64, expGolombDecoder);
          }
        }
      }
    }
  }

  expGolombDecoder.skipUnsignedExpGolomb(); // log2_max_frame_num_minus4
  picOrderCntType = expGolombDecoder.readUnsignedExpGolomb();

  if (picOrderCntType === 0) {
    expGolombDecoder.readUnsignedExpGolomb(); // log2_max_pic_order_cnt_lsb_minus4
  } else if (picOrderCntType === 1) {
    expGolombDecoder.skipBits(1); // delta_pic_order_always_zero_flag
    expGolombDecoder.skipExpGolomb(); // offset_for_non_ref_pic
    expGolombDecoder.skipExpGolomb(); // offset_for_top_to_bottom_field
    numRefFramesInPicOrderCntCycle = expGolombDecoder.readUnsignedExpGolomb();
    for (i = 0; i < numRefFramesInPicOrderCntCycle; i++) {
      expGolombDecoder.skipExpGolomb(); // offset_for_ref_frame[ i ]
    }
  }

  expGolombDecoder.skipUnsignedExpGolomb(); // max_num_ref_frames
  expGolombDecoder.skipBits(1); // gaps_in_frame_num_value_allowed_flag

  picWidthInMbsMinus1 = expGolombDecoder.readUnsignedExpGolomb();
  picHeightInMapUnitsMinus1 = expGolombDecoder.readUnsignedExpGolomb();

  frameMbsOnlyFlag = expGolombDecoder.readBits(1);
  if (frameMbsOnlyFlag === 0) {
    expGolombDecoder.skipBits(1); // mb_adaptive_frame_field_flag
  }

  expGolombDecoder.skipBits(1); // direct_8x8_inference_flag
  if (expGolombDecoder.readBoolean()) { // frame_cropping_flag
    frameCropLeftOffset = expGolombDecoder.readUnsignedExpGolomb();
    frameCropRightOffset = expGolombDecoder.readUnsignedExpGolomb();
    frameCropTopOffset = expGolombDecoder.readUnsignedExpGolomb();
    frameCropBottomOffset = expGolombDecoder.readUnsignedExpGolomb();
  }
  if (expGolombDecoder.readBoolean()) {
    // vui_parameters_present_flag
    if (expGolombDecoder.readBoolean()) {
      // aspect_ratio_info_present_flag
      aspectRatioIdc = expGolombDecoder.readUnsignedByte();
      switch (aspectRatioIdc) {
        case 1: sarRatio = [1, 1]; break;
        case 2: sarRatio = [12, 11]; break;
        case 3: sarRatio = [10, 11]; break;
        case 4: sarRatio = [16, 11]; break;
        case 5: sarRatio = [40, 33]; break;
        case 6: sarRatio = [24, 11]; break;
        case 7: sarRatio = [20, 11]; break;
        case 8: sarRatio = [32, 11]; break;
        case 9: sarRatio = [80, 33]; break;
        case 10: sarRatio = [18, 11]; break;
        case 11: sarRatio = [15, 11]; break;
        case 12: sarRatio = [64, 33]; break;
        case 13: sarRatio = [160, 99]; break;
        case 14: sarRatio = [4, 3]; break;
        case 15: sarRatio = [3, 2]; break;
        case 16: sarRatio = [2, 1]; break;
        case 255: {
          sarRatio = [expGolombDecoder.readUnsignedByte() << 8 |
                      expGolombDecoder.readUnsignedByte(),
                      expGolombDecoder.readUnsignedByte() << 8 |
                      expGolombDecoder.readUnsignedByte() ];
          break;
        }
      }
      if (sarRatio) {
        sarScale = sarRatio[0] / sarRatio[1];
      }
    }
  }
  return {
    profileIdc: profileIdc,
    levelIdc: levelIdc,
    profileCompatibility: profileCompatibility,
    width: Math.ceil((((picWidthInMbsMinus1 + 1) * 16) - frameCropLeftOffset * 2 - frameCropRightOffset * 2) * sarScale),
    height: ((2 - frameMbsOnlyFlag) * (picHeightInMapUnitsMinus1 + 1) * 16) - (frameCropTopOffset * 2) - (frameCropBottomOffset * 2)
  };
};

module.exports = readSequenceParameterSet;