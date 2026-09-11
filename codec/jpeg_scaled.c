/*
 * Bounded JPEG decoding through libjpeg-turbo.
 *
 * The wrapper is MIT licensed. libjpeg-turbo remains subject to its own
 * license files, copied beside the generated WASM module by the build script.
 * It deliberately never creates a full-resolution RGBA image.
 */
#include <setjmp.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <jerror.h>
#include <jpeglib.h>

enum {
  MOON_BAD_JPEG = 1,
  MOON_SOURCE_LIMIT = 2,
  MOON_MEMORY_LIMIT = 3,
  MOON_DECODE_ERROR = 4,
};

enum {
  MOON_MAX_SOURCE_BYTES = 20 * 1024 * 1024,
  MOON_MAX_SOURCE_PIXELS = 64 * 1000 * 1000,
  MOON_MAX_OUTPUT_PIXELS = 8 * 1000 * 1000,
  MOON_MAX_COEFFICIENT_BYTES = 96 * 1024 * 1024,
  MOON_JPEG_MEMORY_BYTES = 128 * 1024 * 1024,
};

struct MoonError {
  struct jpeg_error_mgr jpeg;
  jmp_buf jump;
  int code;
};

struct MoonContext {
  struct jpeg_decompress_struct jpeg;
  struct MoonError error;
  int created;
  unsigned char *output;
};

struct MoonResult {
  unsigned char *data;
  unsigned int width;
  unsigned int height;
  unsigned int length;
  unsigned int source_width;
  unsigned int source_height;
  int progressive;
  int orientation;
};

static struct MoonResult result;

static void moon_error_exit(j_common_ptr common) {
  struct MoonError *error = (struct MoonError *)common->err;
  if (!error->code) {
    error->code = common->err->msg_code == JERR_OUT_OF_MEMORY
      ? MOON_MEMORY_LIMIT
      : MOON_DECODE_ERROR;
  }
  longjmp(error->jump, 1);
}

static void moon_quiet_message(j_common_ptr common) {
  (void)common;
}

void moon_release(void) {
  free(result.data);
  memset(&result, 0, sizeof(result));
}

uintptr_t moon_data(void) { return (uintptr_t)result.data; }
unsigned int moon_width(void) { return result.width; }
unsigned int moon_height(void) { return result.height; }
unsigned int moon_length(void) { return result.length; }
unsigned int moon_source_width(void) { return result.source_width; }
unsigned int moon_source_height(void) { return result.source_height; }
int moon_progressive(void) { return result.progressive; }
int moon_orientation(void) { return result.orientation; }

static int coefficient_bytes_exceed_limit(const struct jpeg_decompress_struct *jpeg) {
  uint64_t bytes = 0;
  int component;

  for (component = 0; component < jpeg->num_components; component += 1) {
    const jpeg_component_info *info = &jpeg->comp_info[component];
    const uint64_t blocks = (uint64_t)info->width_in_blocks * info->height_in_blocks;
    const uint64_t component_bytes = blocks * DCTSIZE2 * sizeof(JCOEF);
    if (blocks == 0 || component_bytes / (DCTSIZE2 * sizeof(JCOEF)) != blocks ||
        component_bytes > MOON_MAX_COEFFICIENT_BYTES - bytes) {
      return 1;
    }
    bytes += component_bytes;
  }

  return 0;
}

static int choose_reduced_scale(struct jpeg_decompress_struct *jpeg, unsigned int max_side) {
  static const unsigned int denominators[] = { 1, 2, 4, 8 };
  size_t index;

  for (index = 0; index < sizeof(denominators) / sizeof(denominators[0]); index += 1) {
    jpeg->scale_num = 1;
    jpeg->scale_denom = denominators[index];
    jpeg_calc_output_dimensions(jpeg);
    if (jpeg->output_width <= max_side && jpeg->output_height <= max_side) {
      return 1;
    }
  }

  return 0;
}

int moon_decode(const unsigned char *bytes, unsigned int length, unsigned int max_side, int orientation) {
  struct MoonContext *context;

  moon_release();
  if (!bytes || length < 4 || bytes[0] != 0xff || bytes[1] != 0xd8) {
    return MOON_BAD_JPEG;
  }
  if (length > MOON_MAX_SOURCE_BYTES || max_side < 1 || max_side > 8192 || orientation < 1 || orientation > 8) {
    return MOON_SOURCE_LIMIT;
  }

  context = (struct MoonContext *)calloc(1, sizeof(*context));
  if (!context) return MOON_MEMORY_LIMIT;

  context->jpeg.err = jpeg_std_error(&context->error.jpeg);
  context->error.jpeg.error_exit = moon_error_exit;
  context->error.jpeg.output_message = moon_quiet_message;

  if (setjmp(context->error.jump)) {
    const int code = context->error.code ? context->error.code : MOON_DECODE_ERROR;
    if (context->created) jpeg_destroy_decompress(&context->jpeg);
    free(context->output);
    free(context);
    moon_release();
    return code;
  }

  jpeg_create_decompress(&context->jpeg);
  context->created = 1;
  context->jpeg.mem->max_memory_to_use = MOON_JPEG_MEMORY_BYTES;
  jpeg_mem_src(&context->jpeg, bytes, length);
  if (jpeg_read_header(&context->jpeg, TRUE) != JPEG_HEADER_OK) {
    context->error.code = MOON_BAD_JPEG;
    moon_error_exit((j_common_ptr)&context->jpeg);
  }

  {
    const uint64_t source_pixels = (uint64_t)context->jpeg.image_width * context->jpeg.image_height;
    if (!source_pixels || source_pixels > MOON_MAX_SOURCE_PIXELS ||
        context->jpeg.data_precision != 8 || context->jpeg.image_width > 65535 ||
        context->jpeg.image_height > 65535 ||
        (context->jpeg.num_components != 1 && context->jpeg.num_components != 3)) {
      context->error.code = MOON_SOURCE_LIMIT;
      moon_error_exit((j_common_ptr)&context->jpeg);
    }
  }

  /* Progressive and multi-scan inputs require a full coefficient image even
   * when IDCT output is reduced. Estimate that allocation before decoding. */
  if ((context->jpeg.progressive_mode || jpeg_has_multiple_scans(&context->jpeg)) &&
      coefficient_bytes_exceed_limit(&context->jpeg)) {
    context->error.code = MOON_MEMORY_LIMIT;
    moon_error_exit((j_common_ptr)&context->jpeg);
  }

  if (!choose_reduced_scale(&context->jpeg, max_side)) {
    context->error.code = MOON_SOURCE_LIMIT;
    moon_error_exit((j_common_ptr)&context->jpeg);
  }
  {
    const uint64_t output_pixels = (uint64_t)context->jpeg.output_width * context->jpeg.output_height;
    const uint64_t output_bytes = output_pixels * 4;
    if (!output_pixels || output_pixels > MOON_MAX_OUTPUT_PIXELS ||
        context->jpeg.output_width > 8192 || context->jpeg.output_height > 8192 ||
        output_bytes / 4 != output_pixels || output_bytes > SIZE_MAX) {
      context->error.code = MOON_SOURCE_LIMIT;
      moon_error_exit((j_common_ptr)&context->jpeg);
    }
  }

  context->jpeg.out_color_space = JCS_EXT_RGBA;
  jpeg_start_decompress(&context->jpeg);

  {
    const unsigned int width = context->jpeg.output_width;
    const unsigned int height = context->jpeg.output_height;
    const unsigned int output_width = orientation >= 5 ? height : width;
    const unsigned int output_height = orientation >= 5 ? width : height;
    const size_t output_bytes = (size_t)output_width * output_height * 4;
    JSAMPARRAY row;

    context->output = (unsigned char *)malloc(output_bytes);
    if (!context->output) {
      context->error.code = MOON_MEMORY_LIMIT;
      moon_error_exit((j_common_ptr)&context->jpeg);
    }

    row = (*context->jpeg.mem->alloc_sarray)((j_common_ptr)&context->jpeg, JPOOL_IMAGE, width * 4, 1);
    while (context->jpeg.output_scanline < height) {
      const unsigned int y = context->jpeg.output_scanline;
      unsigned int x;
      if (jpeg_read_scanlines(&context->jpeg, row, 1) != 1) {
        context->error.code = MOON_DECODE_ERROR;
        moon_error_exit((j_common_ptr)&context->jpeg);
      }
      for (x = 0; x < width; x += 1) {
        unsigned int destination_x = x;
        unsigned int destination_y = y;
        switch (orientation) {
          case 2: destination_x = width - 1 - x; break;
          case 3: destination_x = width - 1 - x; destination_y = height - 1 - y; break;
          case 4: destination_y = height - 1 - y; break;
          case 5: destination_x = y; destination_y = x; break;
          case 6: destination_x = height - 1 - y; destination_y = x; break;
          case 7: destination_x = height - 1 - y; destination_y = width - 1 - x; break;
          case 8: destination_x = y; destination_y = width - 1 - x; break;
          default: break;
        }
        memcpy(context->output + (((size_t)destination_y * output_width + destination_x) * 4),
               row[0] + (size_t)x * 4, 4);
      }
    }

    jpeg_finish_decompress(&context->jpeg);
    result.data = context->output;
    context->output = NULL;
    result.width = output_width;
    result.height = output_height;
    result.length = (unsigned int)output_bytes;
    result.source_width = context->jpeg.image_width;
    result.source_height = context->jpeg.image_height;
    result.progressive = context->jpeg.progressive_mode ? 1 : 0;
    result.orientation = orientation;
  }

  jpeg_destroy_decompress(&context->jpeg);
  free(context);
  return 0;
}
