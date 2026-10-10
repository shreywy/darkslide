# Design notes

## Goal

A free iPhone camera for interval shooting: set the phone down, have it take N photos a second (or one every N seconds) for a set time, and come back to a roll of shots. It has to work without paying for the App Store or sideloading, so it's a web app on GitHub Pages that people add to their home screen.

## Constraints that shaped it

- Safari has no ImageCapture API. Stills are frames grabbed from the `getUserMedia` video track, so resolution is capped at whatever video size the camera offers Safari.
- The camera stops whenever the page isn't on screen, so a run only works with the app open. The scheduler counts slots by wall clock, which means an interruption shows up as missed shots instead of shifting the rest of the run.
- Web pages can't write to the camera roll. `navigator.share({ files })` opens the share sheet, and its "Save Images" option puts files into Photos. Each share needs a fresh tap, so big exports go out in batches.
- For full-resolution intervals, the Shortcuts app's Take Photo action uses the real camera pipeline. The web app launches a user-built shortcut through `shortcuts://run-shortcut` and passes the interval as JSON.

## Decisions

- **No build step.** ES modules served as-is. One vendored dependency (mp4-muxer) for timelapse export.
- **Non-destructive looks.** The raw frame is stored untouched in IndexedDB along with a recipe (camera id, adjustments, effects, crop, random seed). Thumbnails are rendered at capture time. The full render happens in the viewer and on export, so any look can be changed later.
- **One shader.** All 16 looks are parameter sets for a single WebGL2 fragment shader. Print borders and the date imprint are drawn on a 2D canvas afterwards.
- **Encoding off the main thread.** `toBlob` on the main thread gets pushed to idle time while the viewfinder redraws, about a second per call. Two workers with `OffscreenCanvas.convertToBlob` keep up with 4 shots a second in testing, against roughly half missed before.
- **Darkroom look.** Near-black, warm off-white text, one red accent for recording and selection, IBM Plex Mono for readouts. Camera photos in the picker carry the color.

## Not done

- Tap to focus and manual shutter/ISO: Safari doesn't expose them.
- Pinch zoom in the photo viewer.
- A virtualized gallery grid. Thousands of thumbnails load lazily but all get DOM nodes.
