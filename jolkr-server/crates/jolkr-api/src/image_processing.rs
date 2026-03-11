use image::imageops::FilterType;
use image::DynamicImage;
use std::io::Cursor;
use tracing::debug;

/// Maximum pixel dimension for avatar images (covers 3x retina of 80px max display).
const AVATAR_MAX_PX: u32 = 256;

/// Maximum pixel dimension for server icon images (covers 4x retina of 64px max display).
const ICON_MAX_PX: u32 = 256;

/// The purpose of the uploaded image — determines the max output size.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImagePurpose {
    Avatar,
    Icon,
}

impl ImagePurpose {
    pub fn max_px(self) -> u32 {
        match self {
            Self::Avatar => AVATAR_MAX_PX,
            Self::Icon => ICON_MAX_PX,
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "avatar" => Some(Self::Avatar),
            "icon" => Some(Self::Icon),
            _ => None,
        }
    }
}

/// Convert any supported image format (including SVG) to WebP, resized to fit
/// within `max_px × max_px` while preserving aspect ratio.
pub fn convert_to_webp(
    data: &[u8],
    content_type: &str,
    purpose: ImagePurpose,
) -> Result<Vec<u8>, String> {
    let max_px = purpose.max_px();

    let img = if content_type.eq_ignore_ascii_case("image/svg+xml") {
        rasterize_svg(data, max_px)?
    } else {
        decode_raster(data)?
    };

    // Resize if larger than max_px in either dimension (preserving aspect ratio)
    let img = if img.width() > max_px || img.height() > max_px {
        debug!(
            width = img.width(),
            height = img.height(),
            max_px,
            "Resizing image"
        );
        img.resize(max_px, max_px, FilterType::Lanczos3)
    } else {
        img
    };

    // Encode as WebP
    let mut buf = Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageFormat::WebP)
        .map_err(|e| format!("WebP encoding failed: {e}"))?;

    debug!(
        output_size = buf.get_ref().len(),
        width = img.width(),
        height = img.height(),
        "Image converted to WebP"
    );

    Ok(buf.into_inner())
}

/// Decode a raster image (JPEG, PNG, GIF, BMP, TIFF, AVIF, WebP) from bytes.
fn decode_raster(data: &[u8]) -> Result<DynamicImage, String> {
    let reader = image::ImageReader::new(Cursor::new(data))
        .with_guessed_format()
        .map_err(|e| format!("Failed to detect image format: {e}"))?;

    reader
        .decode()
        .map_err(|e| format!("Failed to decode image: {e}"))
}

/// Rasterize an SVG to a `DynamicImage` at the given max dimension.
fn rasterize_svg(data: &[u8], max_px: u32) -> Result<DynamicImage, String> {
    use resvg::usvg::{self, TreeParsing};

    let opt = usvg::Options::default();
    let tree = usvg::Tree::from_data(data, &opt)
        .map_err(|e| format!("Failed to parse SVG: {e}"))?;

    let svg_size = tree.size;
    let sw = svg_size.width() as f32;
    let sh = svg_size.height() as f32;

    // Compute scale to fit within max_px × max_px
    let max_dim = if sw > sh { sw } else { sh };
    let scale = (max_px as f32) / max_dim;

    let width = (sw * scale).ceil() as u32;
    let height = (sh * scale).ceil() as u32;

    if width == 0 || height == 0 {
        return Err("SVG has zero dimensions".to_string());
    }

    let mut pixmap = resvg::tiny_skia::Pixmap::new(width, height)
        .ok_or_else(|| "Failed to create pixmap for SVG".to_string())?;

    let rtree = resvg::Tree::from_usvg(&tree);
    rtree.render(resvg::tiny_skia::Transform::from_scale(scale, scale), &mut pixmap.as_mut());

    // Convert RGBA premultiplied → standard RGBA ImageBuffer
    let rgba_data = pixmap.data().to_vec();
    let img_buf = image::RgbaImage::from_raw(width, height, rgba_data)
        .ok_or_else(|| "Failed to create image from SVG pixels".to_string())?;

    Ok(DynamicImage::ImageRgba8(img_buf))
}
