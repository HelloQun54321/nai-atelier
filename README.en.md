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
3. Add your NovelAI `pst-` key in **Global settings → NovelAI and Anlas** and set a local Anlas budget for that key. For a gateway member key, select **Image gateway** under **Add key** and enter the operator's root URL and member key. Generation, member balances and Vibe encoding use that address. Medium passes through unchanged and requires support on the deployed gateway; gateway generation has no live preview. Switching back to an official key restores its original connection. Member balances do not replace the local budget, and official cost estimates may differ from gateway charges.
4. Open **Global settings → Data and maintenance → Tag completion dictionary** and choose **Update dictionary**. Progress, status, tag count, and generation time appear directly below the settings row.
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
- **Remember confirmations for today**: select “Do not show again today” and explicitly confirm to reuse that operation type and scope on this device until the local date changes. Deletion, spending and storage operations are separate; cancellation records nothing, and changing the Key, cost or destination requires a new decision. Remembering “Save and leave” still performs a real save each time and only leaves after success.
- **Save before leaving**: unsaved style chain or custom character edits offer “Save and leave”, “Discard and leave” and “Keep editing”. Navigation waits for a successful save; a failed save keeps your draft. Editing modes that cannot be fully saved to the library keep the two existing choices: continue editing or discard.
- **Card actions**: style chain and custom character cards have a red delete button at the upper left, with “Favorite → Download image → Copy image → Edit information” stacked at the upper right. The favorite heart stays visible; hover, keyboard focus or a long press on a phone reveals the other actions. Confirmation deletes the entry and clears only unreferenced previews; existing history and collections remain intact. Entries without a cover can still be deleted or edited. Character Tag dictionary entries cannot be deleted from these cards.
- **Batch deletion**: choose “Select” in the toolbar, select within the current filter results, then confirm the number to delete. Batch actions replace the existing toolbar. Failed items remain selected after the actual list is refreshed; shared covers, history and collection records are preserved.
- **Style chain tags**: “Manage tags” beside “Custom tags” in the filter panel lets you search, view usage counts, rename, merge or remove categories across all records of the current type. Confirm the affected count before saving; prompts, parameters, images and untested status are preserved. Renaming updates selected tag filters. Add new categories through a card's edit button.
- **The Windows collector** watches copied image links while its floating window is enabled, downloads the original, and extracts embedded generation metadata into reusable presets. It supports pause, resume, collapse and progress display without interrupting the current app.
- **Vibe Transfer** stores reusable style encodings locally on supported models. Creating a new encoding may cost Anlas; existing encodings can be reused. Supported models allow up to 16 Vibe references, with applicable reference fees estimated from current rules.
- **Precise Reference** provides character/style references on models that support it. V4/V4.5 capabilities are not assumed to apply to V5; the interface follows the selected model and synchronized capabilities.

### Style Roll

Open **Style Roll** in the workspace sidebar or mobile **Resources**. **Start Roll / Roll another round** draws directly from your full artist Tag library and generates a finite batch, one image at a time. The record name is visible in the toolbar; the Roll button stays outside the horizontal scroll area and summarizes image count, artist count and estimated cost. The adjacent **Round settings** menu groups this-round options and record defaults, and opens prompt/generation settings. Weights default to 0.7–1.4 and accept 0.1–3.0 in steps of 0.1; equal bounds give a fixed weight. Starting a round or saving the setup stores the range with the record for future rolls. Locked artists keep their specified weights, and existing recipes stay unchanged. No separate artist pool is needed. Paid batches use the existing total-cost confirmation, pause and cancel; failures do not automatically retry.

**Round settings** also switches the draw mode: all random (default), pinned artists (choose pinned artists once, then only weights are randomized), or fixed weight (every artist uses one weight). While choosing pinned artists you can randomly select, reselect, replace, remove or add one more, add from the artist library, or type tags directly; cards show the pack sample, and artists without one are marked. Selected artists can be blocked globally so no record rolls them again, and the block can be undone immediately.

A **draw only from artists with samples** switch limits draws to artists that have a pack or generated sample; explicitly locked or added artists are kept. The switch is stored with the record and included in the round snapshot. Each record keeps at most 240 candidates; the settings show the remaining capacity, and archived candidates can be permanently cleared from Trash after confirmation while originals and saved style chains remain.

**Manage records → Start from a style chain** (also available on an empty Roll page) creates a new Roll record from an existing style chain without modifying it. The shared prompt gets a `{style}` placeholder in place of the artist block; the negative prompt, model, size, parameters, structured characters and fixed seed are kept. Artists are recognized by an `artist:` or `Artists:` prefix or by bare names found in the artist dictionary; legacy weights are rounded to 0.1 precision, seeds above 32 bits keep their low 32 bits, missing models fall back to the default model, and malformed artist tags are skipped with a notice. Artists become a pinned group with their original weights locked by default; turn off **Keep original weights** to re-roll immediately. Replace any pinned artist later in **Choose pinned artists**; the replacement inherits the replaced slot's weight and updates the record while other artists keep their weights. **Re-roll artist weights** unlocks the pinned group so later rounds randomize weights.

The gallery uses Atelier's shared cards, layout and appearance preferences. Automatic layout keeps at most four large columns; explicit page settings or inherited global column preferences are respected. Cards show the number, round and artist weights. Hover, keyboard focus or touch-and-hold reveals Save, Discard and image actions. The heart is the shared image favorite. Open a card to save its complete style chain or send it to the lab; candidates without an image must be generated first. Details show artist sample thumbnails, and clicking an artist name opens the artist library with that search; multi-selected artists in the library can also be pinned in Roll as a new record. Every round rolls fresh from the artist library; recipes keep only artists and weights, with no source, generation or comparison data.

Search artist tags, Chinese names or `#number`; **Filter** selects saved items, pending images, trash and rounds. All includes pending recipes and does not report them as generated images. **Generate remaining** resumes only eligible original recipes in the current round. Missing images from older rounds can be selected explicitly. Multi-select replaces the existing toolbar with batch actions; completed saves survive partial failure and remaining items can be retried. With continuous generation off, the remaining/generate-selected buttons state that only one image will be generated.

**Manage records**, beside the record selector, renames, creates, starts from a style chain, trashes and restores records. Discarding recipes or records is reversible and preserves originals and existing style chains; archived candidates can be permanently cleared after confirmation. Card **More actions** offers prompt copying, discard, permanent clear and **New record · weights only**. Style Roll only rolls and generates images; style comparison, voting/rankings, evolution trials, automatic weight tests and Seed verification are not offered. Starting from a style chain also provides no ranking, scoring or pairwise comparison. Old comparison records have been cleared by request, and their data structures are no longer supported. Local concurrent saves report conflicts; use Atelier backup for full backups. [Implementation and data notes (Chinese)](./docs/STYLE_ROLL.md).


### The four lab modes

- **Clear this prompt**: the eraser sits outside the input in its existing action area—beside Copy for global prompts, in the character header for positive prompts, and beside the negative prompt heading for character negatives. It clears only that field, then offers “Undo clearing” in the same position. Ctrl/Cmd+Z undoes clearing even with Tag assistance off; Ctrl+Y or Cmd+Shift+Z redoes it. Global and character positive/negative prompts share this control across the four modes and preset workspaces; parameters, character entries and style module switches stay intact.
- **Remember generation settings**: Enabled by default under Settings → “Generation & Lab”. Choose parameters, global positive/negative prompts and character positive/negative prompts independently; all are initially selected. Only selected parts persist across restarts. Unselected parts use free-lab defaults or the saved preset's original values. Current inputs and complete session drafts remain intact; turning off the main switch keeps the scope selection. Each mode and preset has an independent draft per browser/app, and restored preset changes need an explicit save. The free lab reopens with an empty image workspace; originals and history are preserved. Browser drafts are outside D1/R2 backups.
- **One active task per Key**: Pages, browser tabs, phones connected to the same workshop backend, and the Agent share one execution slot. Ordinary busy requests are rejected; “Add to queue” appends a captured configuration, while “Run next” executes after the current image is saved and then resumes the original remainder. Waiting tasks show their position and support cross-device cancellation. Different keys and independent workshops remain separate.
- **Continuous generation and queueing**: Enabled by default under Settings → “Generation & Lab”. This preference is saved on the current device and does not follow Key changes. When off, new requests and cost estimates use one image, batch/interval/queue controls are hidden, and the local Agent cannot request multiple images or queueing. Submitted tasks continue with Pause/Resume and queued-task cancellation available. Re-enabling starts at one image and preserves the saved interval; public queue/proxy settings are unchanged. Without unfinished work, the main action stays “Generate”, not “Add to queue”.
- **Finite background generation**: The four modes share saved/total Pause/Resume and Generate/Add to queue controls, with count and estimated batch cost in the arrow menu. After approval, the runtime backend generates, composites and saves each image; a frozen LAN phone page does not stop the computer. Android retains its foreground service and CPU wake lock for the complete task. Returning to the foreground refreshes actual progress without resending generation or saving twice. Pause keeps the remaining task; preparation-stage pauses remain resumable. Higher costs wait for explicit approval and never override a manual pause. Generation/save failure stops without retries; unsaved images remain downloadable and accounting/queue-cleanup warnings are separate. Closing or reloading stops subsequent requests without restoring the task; power loss or forced termination cannot guarantee an in-flight result. Agent receipts include requested/saved counts and history IDs.
- **Request interval**: Type a value or use the minus/plus buttons to adjust by 0.1 seconds in the generation arrow menu (0.0–3600.0 seconds; default: 2.0). Wait after each image is saved before the next request; the first image starts immediately, and time spent paused counts toward the interval. Preferences are saved per Key. Queued batches, run-next tasks, pages, phones connected to the same workshop, and the Agent share the backend clock. Zero removes only the additional delay. Rate limits and failures still stop generation without retries; the default is a project buffer, not an official safe threshold.

| Mode | Main behavior |
| --- | --- |
| **Text-to-image** | Explore prompts, characters and composition; transparent backgrounds are available on supported models |
| **Image-to-image** | Replace the base image without overwriting the current prompts or parameters; import original configuration explicitly when needed |
| **Inpainting** | Paint a mask, or use focused inpainting to crop, enlarge, generate and blend a selected region back into the original |
| **Outpainting** | Extend the canvas in any direction and regenerate the boundary seam |

Image-to-image output can keep the original size, scale to the current free pixel range, or use custom dimensions. The request uses a resized copy and preserves the original asset. Focused inpainting estimates cost from its cropped request; outpainting uses the resulting canvas. A size within the free pixel range does not by itself guarantee a zero-Anlas request.

The lab offers recommended steps and an optional free-step lock. You retain control of dimensions, steps and references. Supported models provide streamed progress images. Each mode preserves its own working state; reopening the free lab restores text and parameter drafts while the image workspace starts empty.

### History, libraries and sharing

On desktop, **Browse resources** groups AITag, Codex, Danbooru and Pixiv. Expand or collapse the group inside the full sidebar; your choice is remembered on this browser, and the current source remains visible when the group is closed. In the icon-only sidebar, click it to open a menu on the right with the current source highlighted. Artist, character and collection libraries remain directly accessible. Mobile keeps its existing **Resources** panel.

- Generation history stores original images and actual prompts, seeds and parameters locally. Reuse a result by importing it back into the lab. Browse full images, favorites and randomized results without changing the originals.
- **Creation footprint**: open the standalone page from Records → Creation footprint on desktop, or from the history toolbar on mobile. The Week / Month / Year selector drives works, active days, current streak, favorites, top style chains and artists, the heatmap and trend; it defaults to the current year. All three use a dropdown: Week picks a specific week, Month picks a year and month, and Year picks a specific year or all years; future periods are not listed. It also covers characters and frequent tags, Vibe assets/encodings, Roll experiments/candidates/saved variants, collection sources and folders, assistant sessions and messages, local budget and cost, failed/cancelled/blocked generation events (recorded from this version onward) and CSV export. Selecting a day, chain, artist, character, model, tag or operation opens history with that filter. It reads local aggregates only, never chat content or full prompts; nothing is uploaded, and it does not claim official quota settlement.
- **Artist sample packages**: manage V4.5 (about 2.73 GB) and V5 Curated (about 1.03 GB) under Settings → Artist Preview Gallery. Each model row places Download/Pause/Resume beside a three-dot menu. Active downloads show real progress; completed packages show availability and entry count. The menu offers Use local file, Rebuild index and Disconnect. Atelier downloads through its network/proxy into the configured cache/resource directory, with integrity checks and resumable partial files, then automatically connects and indexes the package. Existing files remain read-only in place. Packages, partial downloads and indexes follow resource directory changes; interrupted downloads resume only on request. Windows hosts manage the files and LAN clients can browse them; standalone Android does not yet support local packages. The artist library is built from the Tag dictionary, the selected V4.5/V5 package and custom samples; legacy saved Artist rows and browser favorite lists no longer drive its list or favorites filter, and remain untouched without migration or deletion. History image references remain protected. Favorites persist independently of package files. Clicking an artist sample selects the artist without opening a lightbox. Artist-library and collection list/detail previews share conservative cropping of confirmed package padding; masonry uses the resulting aspect ratio. Saved package favorites render from their own images even after the package is disconnected. Original-image viewing, downloads/copies, history and saved files remain unchanged. Custom samples and images without confirmed package provenance are not automatically cropped.
- **Per-card versions and samples**: click the version pill at the top left of an artist card to switch directly between V4.5 and V5. The top-level buttons reset all card overrides, even when selecting the current version again; search and selected artists are retained. Missing samples keep the full cover proportions and a fixed **Add sample** button. It generates one image in place for that artist and version; if no template is saved, edit it on the same page and choose **Save and generate sample**. Every card with an image also has a small floating generation button: package samples say **Generate sample**, and custom samples say **Regenerate sample**. The toolbar's separate Artist library settings button only saves V4.5/V5 templates. Live preview is requested according to model support and does not depend on the lab's global preview setting; unsupported models show the finished image. The backend saves history first, then idempotently adds the custom sample, which appears on the card while package samples and prior custom samples remain. On cards that already have a sample, generating again uses a new random Seed for that request; the first sample for a missing card uses the template's fixed Seed. If sample saving fails, retry saving the existing history image without generating again. Existing cost, Key and same-Key serialization rules apply; originals and history remain unchanged.
- AITag indexes public generation examples and parameters; Pixiv provides rankings, search and artist works; Danbooru provides image/tag references. Artist and character libraries support discovery and reuse, while Collections hold deliberately saved materials.
- In AITag and Codex details, the third purple **Use as base image** button lets you choose **Image to image**, **Inpaint** or **Outpaint** for the current image. It preserves the current prompts and parameters and does not generate automatically. Codex places **More actions** fourth and keeps the base image choices only in the purple button; on narrow screens, paging and the action group can occupy separate rows.
- **Collections** organize saved images into folders with reusable tags. Combine folders, sources and multiple tags when filtering. “Select” in the toolbar starts batch selection, and “Manage tags” sits beside the tag heading in the filter panel. Save to a chosen folder or Unorganized; desktop users can drag one or several selected images into a folder, while touch and keyboard users can use the move controls.
- **Legacy favorites**: old style-chain and custom-character marks appear in Collections using their current covers, with the cover heart and covered-entry favorite filter sharing the same image state. Marks without a cover or a matching entry are retained. Existing images are deduplicated and canceled favorites stay canceled. Loading is read-only: it does not copy images or alter source prompts/history; references are saved only when you organize or remove them. Unsaved compatibility references depend on the old marks in the original browser.
- **Local image import**: “Add to Collections” accepts multiple local files, or drop them onto the collection page or a desktop folder. Review candidates, choose a shared folder and shared tags, and keep each image's own prompts, parameters and characters. No prompt is required: the main view shows the image and filename-derived title, with optional generation details collapsed until you choose to edit them. PNG/JPEG/WebP files can be up to 12 MB each. Per-image progress and failures remain visible; retry imports only unfinished items. Web links and directory import are not supported.
- Image download and copy actions appear on hover or keyboard focus, and on long-press for touch. Enable **remove generation information when sharing images** in the separate **Global settings → Privacy and sharing → Image metadata cleaning** panel. The default removes all generation information; **Prompts only** removes image and character positive/negative prompts and their hidden copies while retaining recorded, recognized generation parameters. Missing parameters are not filled with defaults. Originals and history are preserved, and cleaning failures are reported. **Custom text** accepts text and emoji: leave it empty to apply the selected cleaning mode, or enter content to write into the shared PNG's description and prompt fields afterward. Prompts only still retains the actual parameters. Disabling cleaning preserves the mode and text but does not apply them. These settings are independent of Safe mode. Downloaded files retain the output metadata; image clipboard operations or website re-encoding may remove it.
- Tag completion supports Chinese/English lookup and weighted prompt groups. Choose Brackets or Numeric, then use Add weight to convert. Both show a multiplier: each brace layer multiplies by 1.05 and each square-bracket layer divides by 1.05. Brackets still adjust one layer at a time; numeric adjustments use ±0.1 or ±0.01 with `Shift`. Equivalent weights show the same value; differing weights show Different weights and adjust independently. Display rounding never rewrites the prompt automatically. Dictionary sizes depend on the installed dataset. Optional AI translation uses your configured LLM service and its billing rules.
- Existing multi-tag groups stay together during continuous adjustments through unweighted text, such as `{a, b} → a, b → [a, b]`. Deselecting the group or editing the prompt releases this temporary group boundary.
- Edit tags directly in the translation area: the trailing input shares dictionary completion, with suggestions anchored to that field; press Enter or leave it to append, and drag the tag area’s bottom-right corner to adjust its height. The red trash button enters deletion mode, hides weight controls and markers, and lets you select individual tags for confirmed batch deletion while preserving the remaining weights. The circular arrow undoes edits; Ctrl/Cmd+Z undoes, Ctrl+Y or Ctrl/Cmd+Shift+Z redoes. Selected tags support copy/cut of their original prompt text and paste to append; text fields keep native shortcuts.
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
- **Image list layout** offers global defaults and settings for each gallery page. Pages follow global settings by default; turn off **Follow global settings** to choose that page's masonry, portrait or square layout and desktop (1–7) and mobile column counts. Turn it on again to restore inheritance. Browsing history and filtered views use their parent gallery's settings. Masonry appends use existing columns’ actual heights when available, without moving displayed cards when images load or sidebars resize. Changing search, filters or sorting in style chains, the artist library, character library or Collections starts at the top; ordinary data refreshes and returning from details preserve your position.
- A **st-chatu queue** coordinates requests using a key fingerprint without sending the raw key, prompt or image to the queue. A **compatible generation relay** receives the current key, prompts and required references because it performs the request. Third-party billing is not implemented; the displayed official estimate is not the relay's price.
- Canceling a relay connection stops local waiting; whether remote generation stops is determined by the service. Failures do not automatically resend a paid generation request or fall back to another provider.

## Data and backups

| Workspace | Persistent creative data |
| --- | --- |
| **Windows installer** | `%LOCALAPPDATA%\NAI Atelier\workspace\local-data` |
| **Source deployment** | `<project root>/local-data/` |
| **Standalone Android** | Private app SQLite database and original-image files; exported through encrypted app backups |

- **Storage locations:** Open **Global settings → Data and maintenance → Storage locations** to view or change the workspace data and cache/download-resource folders. Only the Windows installer or source atelier running on that computer can change them; LAN phones can only view the computer's data location, and Android's private data location is managed by the system. A migration copies and verifies the data before restarting from the new location. The old folder is kept and D1/R2 storage identifiers do not change. Opening another workspace does not merge data. The cache can use its own folder or follow the workspace data folder; switching copies existing thumbnails, tagging models and dictionaries.
- **Export location:** On the same page, choose **System default** (preserves the browser's existing download behavior), **Custom folder** (remembers the selected location), or **Ask every time**. Click **Change** beside the current export location to choose a folder directly; confirming switches to custom mode, while cancelling keeps the previous setting. Images and files share this location. The desktop assistant uses it when no folder is explicitly specified. Android can select a public export folder provided by the system; browser options depend on download settings and folder permissions.
- **Backup folder:** The important-data backup destination can still be entered manually. When the local computer allows storage management, **Browse folders** can select it as well.

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
- Style Roll workflow and gallery inspiration: [@sdnwls](https://github.com/sdnwls) / [nai-style-lab](https://github.com/sdnwls/nai-style-lab). Independently implemented for Atelier without copying its code or assets.
- Local tagging model: [SmilingWolf WD ViT Tagger V3](https://huggingface.co/SmilingWolf/wd-vit-tagger-v3), Apache-2.0.

This README provides the localized usage guide. The [complete Chinese introduction](./README.md), [product decisions](./docs/PRODUCT_DECISIONS.md), [technical documents](./docs/WINDOWS_DESKTOP.md), [change history](./CHANGELOG.md) and [author's personal note](./README.md#一点个人吐槽) are currently maintained in Simplified Chinese.
