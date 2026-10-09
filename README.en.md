<div align="center">
  <img src="./public/app-icon.png" width="96" alt="NAI Atelier icon" />

  # NAI Atelier

  **A personal, local NovelAI creative workspace**

  **[简体中文](./README.md) · [繁體中文](./README.zh-TW.md) · [English](./README.en.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md)**

  [Source version](./package.json) · [Downloads](https://github.com/HelloQun54321/nai-atelier/releases) · [Changelog](./CHANGELOG.md) · [MIT License](./LICENSE)
</div>

## About

NAI Atelier is a personal NovelAI workspace for Windows and Android. It connects the steps of finding references, composing prompts, generating one image, reviewing and refining it, and saving useful results as reusable assets.

Style chains, characters, Vibe encodings, saved collections and original generation history belong to your local workspace. Image generation and the AI assistant use online services with your own credentials; the app does not run a local NovelAI generation model. It is designed for individual use and a trusted home network.

This project is independently maintained and based on [kirafishy/NaiPromptManager](https://github.com/kirafishy/NaiPromptManager).

## Screenshots

The shared screenshots show the Chinese interface with image safety mode enabled. They illustrate the layout; the app also supports the other languages listed above.

<div align="center">
  <img src="./docs/screenshots/desktop-presets-gallery.webp" width="860" alt="Style chains and reusable presets" />
  <p>Style chains and reusable presets</p>
  <img src="./docs/screenshots/desktop-lab-workbench.webp" width="860" alt="The generation lab" />
  <p>The four-mode generation lab</p>
  <img src="./docs/screenshots/mobile-presets-gallery.webp" width="300" alt="Mobile browser over LAN" />
  <p>Mobile browser access to the computer workspace</p>
</div>

## Getting started

| Edition | Requirements | How to start |
| --- | --- | --- |
| **Windows installer** — recommended for everyday desktop use | Windows 10/11 x64; no Node.js or Git required | Download a published `NAI-Atelier-Setup-*.exe` and its `.sha256` file from [Releases](https://github.com/HelloQun54321/nai-atelier/releases) |
| **Source deployment** | Node.js 22+ (24.x recommended), Git | Clone the repository and run the commands below |
| **Standalone Android APK** | Android 8.0+, ARM64, an up-to-date Android System WebView | Install a provided or locally built APK; see the [Android guide](./docs/ANDROID_STANDALONE.md) |

The source version and the published download version can differ. A local build does not create a public release or an in-app update. Downloadable editions are determined by the actual Release attachments.

### Windows

1. Run the installer, choose its language and the program installation folder. It checks the Microsoft Visual C++ x64 runtime; if the runtime is missing, follow the installer instructions and run setup again after installing it.
2. Open **NAI Atelier** from the desktop, Start menu or `NAI Atelier.exe` in the installation folder.
3. Add your NovelAI `pst-` key in **Global settings → NovelAI and Anlas** and set a local Anlas budget for that key.
4. Open **Global settings → Data and maintenance → Tag completion dictionary** and choose **Check and update**.
5. In **Lab**, choose text-to-image, enter a prompt, select the model and parameters, and check the displayed cost before generating. Save a useful configuration as a style chain.

Closing the Windows window minimizes it to the tray and keeps the local service running. Use **Quit atelier** in the tray or app menu to stop it. Press `Alt` to show the menu, which also provides access to the data folder and startup log. See the [Windows guide](./docs/WINDOWS_DESKTOP.md) for details.

### Source deployment

```bash
git clone https://github.com/HelloQun54321/nai-atelier.git
cd nai-atelier
npm ci
npm run dev:local
```

Wait for the service to report that it is ready, then open [http://localhost:3000](http://localhost:3000). Dependency installation creates the Windows desktop shortcut automatically. The full source launcher rebuilds the app and restarts a running service belonging to this project, so finish active tasks before using it again.

### Interface and assistant language

Choose **Global settings → Appearance and gallery → Language** to switch between Simplified Chinese, Traditional Chinese, English, Japanese and Korean. The interface changes immediately and remembers your choice for that browser or device. Windows titles, startup screens, menus, the tray and the collector window follow it too; the installer offers the same five languages.

The **Creative Assistant** follows the selected language from its next request, including progress and replies. Existing conversations, prompts, tags, custom asset names and source-site content keep their original text. An explicitly requested language for a creative output takes precedence over the conversation language.

UI translations ship with the app and require no online translation service. The Tag completion dictionary remains Chinese–English; changing the UI language does not translate the dictionary.

## Using a phone

### Accessing the computer over LAN

Connect the phone to the same trusted Wi-Fi as the computer. Copy the current address from **Global settings → Data and maintenance → LAN access**, then enter the four-digit PIN. The computer is the data source for this mode and must stay running. The installer can choose different ports if the usual ports are occupied; use the address shown in settings or the current startup log.

Generation and gateway-proxied requests use the computer's network connection. A site opened directly by the phone's browser still depends on the phone's network. This is a home-network feature, not a public hosting setup.

Touch controls support long-press to reveal image actions, full-image viewing, pinch zoom, double-tap zoom and panning. Returning from a detail view preserves the gallery position. Mobile editing groups the lab into image, prompt and parameter tabs.

### Standalone Android

The APK runs its own workspace on the phone, including all four generation modes, libraries, the assistant and optional local tagging. It uses the phone's network, storage and credentials. It does not automatically merge or synchronize with the computer workspace.

Desktop clipboard monitoring, unrestricted computer folders, the local SillyTavern bridge and EXE updates are desktop features. Android exports through the system file picker. **Uninstalling Android deletes its private app data**, so export an encrypted backup first. Same-signature APKs with a higher build number can update in place; see the [Android guide](./docs/ANDROID_STANDALONE.md).

## Creative workflow

### Style chains and references

- **Style chains** save reusable prompt modules, negative prompts, characters, seeds, sampling settings and references. Character prompts and composition positions stay separate; positioning follows the selected model's capabilities.
- **Save before leaving**: unsaved style chain or custom character edits offer “Save and leave”, “Discard and leave” and “Keep editing”. Navigation waits for a successful save; a failed save keeps your draft. Editing modes that cannot be fully saved to the library keep the two existing choices: continue editing or discard.
- **Card actions**: style chain and custom character cards have a red delete button at the upper left, with “Download image → Copy image → Edit information” stacked at the upper right and the favorite button beside the name. Hover, keyboard focus or a long press on a phone reveals the actions. Confirmation deletes the entry and its local preview; entries without a cover can still be deleted or edited. Character Tag dictionary entries cannot be deleted from these cards.
- **The Windows collector** watches copied image links while its floating window is enabled, downloads the original, and extracts embedded generation metadata into reusable presets. It supports pause, resume, collapse and progress display without interrupting the current app.
- **Vibe Transfer** stores reusable style encodings locally on supported models. Creating a new encoding may cost Anlas; existing encodings can be reused. Supported models allow up to 16 Vibe references, with applicable reference fees estimated from current rules.
- **Precise Reference** provides character/style references on models that support it. V4/V4.5 capabilities are not assumed to apply to V5; the interface follows the selected model and synchronized capabilities.

### The four lab modes

| Mode | Main behavior |
| --- | --- |
| **Text-to-image** | Explore prompts, characters and composition; transparent backgrounds are available on supported models |
| **Image-to-image** | Replace the base image without overwriting the current prompts or parameters; import original configuration explicitly when needed |
| **Inpainting** | Paint a mask, or use focused inpainting to crop, enlarge, generate and blend a selected region back into the original |
| **Outpainting** | Extend the canvas in any direction and regenerate the boundary seam |

Image-to-image output can keep the original size, scale to the current free pixel range, or use custom dimensions. The request uses a resized copy and preserves the original asset. Focused inpainting estimates cost from its cropped request; outpainting uses the resulting canvas. A size within the free pixel range does not by itself guarantee a zero-Anlas request.

The lab offers recommended steps and an optional free-step lock. You retain control of dimensions, steps and references. Supported models provide streamed progress images. Each mode preserves its own working state; reopening the free lab restores text and parameter drafts while the image workspace starts empty.

### History, libraries and sharing

- Generation history stores original images and actual prompts, seeds and parameters locally. Reuse a result by importing it back into the lab. Browse full images, favorites and randomized results without changing the originals.
- AITag indexes public generation examples and parameters; Pixiv provides rankings, search and artist works; Danbooru provides image/tag references. Artist and character libraries support discovery and reuse, while Collections hold deliberately saved materials.
- **Collections** organize saved images into folders with reusable tags. Combine folders, sources and multiple tags when filtering. Save to a chosen folder or Unorganized; desktop users can drag one or several selected images into a folder, while touch and keyboard users can use the move controls.
- Image download and copy actions appear on hover or keyboard focus, and on long-press for touch. When **remove generation information when sharing images** is enabled, sharing produces a cleaned copy while preserving the original and its metadata. A cleaning failure is reported.
- Tag completion supports Chinese/English lookup and weighted prompt groups. Choose Brackets or Numeric, then use Add weight to convert. Both show a multiplier: each brace layer multiplies by 1.05 and each square-bracket layer divides by 1.05. Brackets still adjust one layer at a time; numeric adjustments use ±0.1 or ±0.01 with `Shift`. Equivalent weights show the same value; differing weights show Different weights and adjust independently. Display rounding never rewrites the prompt automatically. Dictionary sizes depend on the installed dataset. Optional AI translation uses your configured LLM service and its billing rules.
- Existing multi-tag groups stay together during continuous adjustments through unweighted text, such as `{a, b} → a, b → [a, b]`. Deselecting the group or editing the prompt releases this temporary group boundary.
- Edit tags directly in the translation area: type in the trailing input and press Enter or leave it to append. The red trash button enters deletion mode, hides weight controls and markers, and lets you select individual tags for confirmed batch deletion while preserving the remaining weights. The circular arrow undoes edits; Ctrl/Cmd+Z undoes, Ctrl+Y or Ctrl/Cmd+Shift+Z redoes. Selected tags support copy/cut of their original prompt text and paste to append; text fields keep native shortcuts.
- WD ViT V3, WD SwinV2 V3 and WD EVA02-Large V3 run local CPU tagging after an explicit model download. Manage them in **Global settings → Generation preferences and lab**. Tagging does not consume Anlas or require a cloud inference upload; speed and memory usage depend on the model and device.

### Creative Assistant

Open the assistant from the sidebar or floating button. It can inspect the current page, edit lab drafts, work with assets and use canvas tools for masks and selections. On the desktop it can access authorized local image folders and export files; Android file tools stay within the app's creative documents directory.

Permissions are **Read only**, **Standard** and **Full access**. Generation, deletion and clearing still require creator confirmation. Existing assets and later manual edits are respected. The model provider and credentials are configured separately from NovelAI, and provider usage can incur its own charges.

## Costs, keys and privacy

- **Anlas**, **Opus allowance**, **local budget** and **official balance** are different values. Budgets and usage estimates are tracked per key; a local budget is not the official account balance or a guarantee about billing.
- Zero-Anlas eligibility depends on the active subscription, model, actual dimensions and steps, remaining Opus allowance, and references. Editing modes may also qualify. An inactive subscription does not automatically make a key unusable; the official response determines permissions and usable balance.
- The app synchronizes model capabilities, free thresholds and cost coefficients from the NovelAI web app. If extraction fails, it retains the last complete rules and shows the problem. Check the current estimate and confirm paid generation or new reference encoding when prompted; final billing belongs to the service.
- Opus percentage and estimated remaining image counts use the synchronized conversion rules. They are estimates, not a fixed promise of a particular number of images.
- Multiple NovelAI keys can have aliases; key values are masked in the interface. Safety mode blurs images, and appearance settings control light/dark modes, accent, spacing, corners, fonts and gallery layout.
- A **st-chatu queue** coordinates requests using a key fingerprint without sending the raw key, prompt or image to the queue. A **compatible generation relay** receives the current key, prompts and required references because it performs the request. Third-party billing is not implemented; the displayed official estimate is not the relay's price.
- Canceling a relay connection stops local waiting; whether remote generation stops is determined by the service. Failures do not automatically resend a paid generation request or fall back to another provider.

## Data and backups

| Workspace | Persistent creative data |
| --- | --- |
| **Windows installer** | `%LOCALAPPDATA%\NAI Atelier\workspace\local-data` |
| **Source deployment** | `<project root>/local-data/` |
| **Standalone Android** | Private app SQLite database and original-image files; exported through encrypted app backups |

The Windows installer and source deployment use separate workspaces. Android has its own workspace too. A new, empty workspace in another edition does not mean that the original data was overwritten. The Windows program folder is separate from the data folder; uninstalling Windows keeps personal data by default.

For desktop backup, use **Global settings → Data and maintenance → Important data backup → Create full backup now**. Alternatively, fully stop the relevant service and copy its complete `local-data/` folder. In the installed edition, stop via **Quit atelier**, not just the close button. Browser drafts that have not been saved are outside the D1/R2 backup.

Do not change the D1 database name/ID, R2 bucket name or bindings in `wrangler.toml`: these identify the existing local store, and changing them can make the app load a new, empty database. Original assets and credentials belong to `local-data`; thumbnails and tagging models belong to regenerable caches. Copy the complete store when backing up manually.

On Android, export an encrypted `.naiatelier` backup with a password of at least eight characters before uninstalling, resetting or changing devices. It includes originals, database, settings, keys and assistant/Pixiv credentials; caches, dictionary and models can be downloaded again. A lost backup password cannot be recovered. See the [Android guide](./docs/ANDROID_STANDALONE.md) for restore behavior and storage requirements.

## Updates

- **Windows:** open **Global settings → Data and maintenance → App updates**, check and download, then select **Restart and install**. Only published releases appear. Startup checks quietly; ordinary exit does not install an update. Pre-release acceptance is enabled by default and can be disabled. Finish active generation, assistant, collection, backup and dictionary tasks before installation; keep a full backup for major changes.
- **Source:** finish tasks and stop the source service, then run the repository's `更新 NAI Atelier.bat` on Windows or `sh scripts/update-local.sh` on macOS/Linux. The updater follows published releases and stops for custom branches, forks or local modifications. ZIP downloads do not provide the Git update environment.
- **Android:** install a compatible same-signature APK with a higher build number. Android build numbers progress separately from the desktop/source display version; a desktop release does not automatically rebuild or publish the APK.

## Integration and development

The SillyTavern connector exchanges selected style chains, Vibe encodings and original history images with st-chatu8. See the [bridge guide](./docs/SILLYTAVERN_BRIDGE.md) and [connector README](./sillytavern-extension/npm-bridge/README.md).

The desktop stack uses React 19, TypeScript, Vite and Tailwind CSS, with a Node media gateway and local Cloudflare Worker runtime. Desktop storage uses local D1/SQLite and R2-compatible objects; Sharp handles thumbnails and ONNX Runtime handles tagging. Android uses native SQLite, files, networking and ONNX Runtime with the shared mobile UI.

| Command | Purpose |
| --- | --- |
| `npm run dev:local` | Start the full local source workspace |
| `npm run dev` | Start the Vite frontend development server |
| `npm run build` | Build frontend and Worker |
| `npm run build:desktop` | Build the Windows installer from public source |
| `npm run build:android` | Build the signed ARM64 Android APK |
| `npm run update:tags` | Update and rebuild the Chinese–English Tag dictionary |
| `npm run test -- <path>` | Run focused frontend tests |
| `npm run test:gateway` | Run gateway, bridge and local-backend tests |
| `npm run test:live-sync` | Explicitly verify official constant extraction online |

Desktop builds require a Windows build environment; Android also needs JDK 21 and the Android SDK. Detailed build instructions are in the [Windows](./docs/WINDOWS_DESKTOP.md) and [Android](./docs/ANDROID_STANDALONE.md) guides. Building alone does not upload a release. Contribution rules are in [AGENTS.md](./AGENTS.md); the product intent is in [VIBER_INTENT.md](./VIBER_INTENT.md).

## Credits and further reading

- Original project: [kirafishy/NaiPromptManager](https://github.com/kirafishy/NaiPromptManager), MIT.
- Chinese–English Tag data: [ffdkj's Danbooru translation table](https://github.com/ffdkj/ffdkj-Danbooru_Tag-Chinese-English-Translation-Table).
- Integration and shared queue inspiration: [damoshen123/st-chatu8](https://github.com/damoshen123/st-chatu8).
- Local tagging model: [SmilingWolf WD ViT Tagger V3](https://huggingface.co/SmilingWolf/wd-vit-tagger-v3), Apache-2.0.

This README provides the localized usage guide. The [complete Chinese introduction](./README.md), [product decisions](./docs/PRODUCT_DECISIONS.md), [technical documents](./docs/WINDOWS_DESKTOP.md), [change history](./CHANGELOG.md) and [author's personal note](./README.md#一点个人吐槽) are currently maintained in Simplified Chinese.
