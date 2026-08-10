// src/imageUtils.js
//
// Browser replacements for the two native modules the original app used:
//   - expo-image-picker    -> a plain <input type="file" accept="image/*">
//   - expo-image-manipulator -> the Canvas API (draw + crop + re-export as JPEG)
// Both run entirely on the visitor's device; no upload, no server.

// Reads a picked File and returns it as a resized, compressed data URL
// (so large phone photos don't bloat IndexedDB). Mirrors the old
// `ImagePicker.launchImageLibraryAsync({ quality: 0.9 })` call.
export function fileToDataUrl(file, maxDimension = 1600, quality = 0.9) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read that image file.'));
      img.onload = () => {
        const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
        const width = Math.round(img.width * scale);
        const height = Math.round(img.height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Crops the tagged region out of the source photo using real pixel
// dimensions (the original React Native version used placeholder pixel
// math — this version reads the actual image size first, which the
// project's own README flagged as the thing to fix for a real build).
export function cropImage(sourceDataUrl, { top_percent, left_percent, width_percent, height_percent }) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('Could not load the source photo for export.'));
    img.onload = () => {
      const cropX = (left_percent / 100) * img.width;
      const cropY = (top_percent / 100) * img.height;
      const cropW = (width_percent / 100) * img.width;
      const cropH = (height_percent / 100) * img.height;

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(cropW));
      canvas.height = Math.max(1, Math.round(cropH));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.src = sourceDataUrl;
  });
}

// Triggers a browser download for a data URL (used so "Export" gives the
// shop owner an actual file, since there's no app-private document
// directory on the web to quietly save it into).
export function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
