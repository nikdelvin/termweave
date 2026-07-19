<div align="center">
  <img
    src="./sdk/termweave-sdk.png"
    width="100%"
    alt="Termweave — Build terminal apps. Ship them native."
  />
</div>

<p align="center">
  <img
    src="./sdk/termweave-sdk.gif"
    width="100%"
    alt="Termweave project preview"
  />
</p>

📟 **Termweave** turns an [OpenTUI](https://github.com/anomalyco/opentui) interface into a native
[Tauri](https://tauri.app/) desktop app.

You build the interface with
[Solid](https://www.solidjs.com/) — Termweave handles everything else:<br>
📦 The window, terminal renderer, app lifecycle,
and native packaging.

## ✨ Why Termweave?

- Build with OpenTUI and Solid instead of recreating a terminal UI in the browser.
- Run your app in a native, resizable Tauri window.
- Configure the name, colors, window size, and icon in ⚙️ **one config file**.
- See source changes without restarting the native window.
- Create a native bundle with ⚡️ **one command**.

## 🚀 Quick start

You need macOS, [Bun 1.3+](https://bun.sh/), a stable
[Rust toolchain](https://www.rust-lang.org/tools/install), and the Xcode Command Line Tools.

Create an empty project and run the installer:

```sh
mkdir my-termweave-app
cd my-termweave-app
curl -fsSLo install.sh https://raw.githubusercontent.com/nikdelvin/termweave/main/sdk/install.sh
sh install.sh
```

The installer asks for your app name and metadata, creates the starter project, and installs its
dependencies.

Start the app:

```sh
bun run dev
```

## 🎨 Make it yours

You only need to edit three places:

1. `src/App.tsx` — build your OpenTUI interface.
2. `app.config.json` — set the app name, colors, window size, and bundle metadata.
3. `app.icon.png` — replace the default app icon.

Changes under `src/` reload while the app is running. Restart `bun run dev` after changing the
configuration or icon.

Your project stays small:

```text
my-termweave-app/
├── src/App.tsx
├── app.config.json
├── app.icon.png
├── package.json
└── termweave/       Managed SDK checkout
```

## 🧰 Commands

| Command          | What it does                                     |
| ---------------- | ------------------------------------------------ |
| `bun run dev`    | Check the project and start the desktop app.     |
| `bun run build`  | Build native bundles into `build/`.              |
| `bun run check`  | Run linting, type checks, and formatting checks. |
| `bun run update` | Update the managed SDK to the latest `main`.     |

## 🍎 Current status

Termweave currently supports macOS for installation and development. Native bundles are built for
the current machine.

## 🤝 Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) to get started.

Termweave is available under the [MIT License](./LICENSE).

⭐ If Termweave helps you build something,
[star the repository](https://github.com/nikdelvin/termweave) and share what you made.
