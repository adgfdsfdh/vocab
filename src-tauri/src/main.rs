// Окно-виджет «Словарь» для Windows (F09): маленькое окно поверх всех, открывает опубликованный сайт
// в мини-виде. Горячая клавиша Ctrl+Shift+Space, иконка в трее, автозапуск, прозрачность.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent, Wry,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

const SITE_URL: &str = "https://adgfdsfdh.github.io/vocab/?compact=1";
const MAIN: &str = "main";
const MIN_OPACITY: f64 = 0.3;
/// Пункты «Прозрачность» в трее, в процентах (0 = непрозрачно). Ползунок в окне — шагом 5%.
const TRANSPARENCY_LEVELS: [u8; 8] = [0, 10, 20, 30, 40, 50, 60, 70];

/// Настройки окна — в %APPDATA%\io.github.adgfdsfdh.vocab\settings.json.
/// Позицию и размер окна хранит плагин window-state (там же, .window-state.json).
#[derive(Serialize, Deserialize)]
#[serde(default)]
struct Settings {
    opacity: f64,
    autostart: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self { opacity: 0.9, autostart: true }
    }
}

struct AppState {
    path: PathBuf,
    settings: Mutex<Settings>,
    levels: Vec<(u8, CheckMenuItem<Wry>)>,
}

impl AppState {
    fn update(&self, change: impl FnOnce(&mut Settings)) {
        let mut settings = self.settings.lock().unwrap();
        change(&mut settings);
        if let Some(dir) = self.path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string_pretty(&*settings) {
            let _ = fs::write(&self.path, json);
        }
    }
}

fn load_settings(path: &PathBuf) -> Settings {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn window_flags() -> StateFlags {
    StateFlags::POSITION | StateFlags::SIZE
}

fn transparency_of(opacity: f64) -> u8 {
    ((1.0 - opacity) * 100.0).round() as u8
}

fn apply_opacity(app: &AppHandle, value: f64, notify_page: bool) {
    let value = if value.is_finite() { value.clamp(MIN_OPACITY, 1.0) } else { 1.0 };
    let state = app.state::<AppState>();
    state.update(|s| s.opacity = value);
    let percent = transparency_of(value);
    for (level, item) in &state.levels {
        let _ = item.set_checked(*level == percent);
    }
    // Выбрали в трее — сообщаем странице (она меняет прозрачность и ползунок).
    if notify_page {
        if let Some(window) = app.get_webview_window(MAIN) {
            let js = format!("window.dispatchEvent(new CustomEvent('vocab:opacity', {{ detail: {value} }}))");
            let _ = window.eval(&js);
        }
    }
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        // Страница переходит к вводу слова и ставит курсор в поле.
        let _ = window.eval("window.dispatchEvent(new Event('vocab:shown'))");
    }
}

fn toggle_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN) else { return };
    if window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false) {
        let _ = window.hide();
    } else {
        show_window(app);
    }
}

// Команды, которые вызывает страница (src/desktop/desktop.ts).
#[tauri::command]
fn get_opacity(state: State<'_, AppState>) -> f64 {
    state.settings.lock().unwrap().opacity
}

#[tauri::command]
fn set_opacity(app: AppHandle, value: f64) {
    apply_opacity(&app, value, false);
}

#[tauri::command]
fn hide_window(window: WebviewWindow) {
    let _ = window.hide();
}

#[tauri::command]
fn start_drag(window: WebviewWindow) {
    let _ = window.start_dragging();
}

fn main() {
    let hotkey = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);

    tauri::Builder::default()
        // Второй запуск (ярлык при уже открытом окне) просто показывает окно.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_window(app)))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--autostart"])))
        .plugin(tauri_plugin_window_state::Builder::new().with_state_flags(window_flags()).build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed && *shortcut == hotkey {
                        toggle_window(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![get_opacity, set_opacity, hide_window, start_drag])
        .setup(move |app| {
            let path = app.path().app_config_dir()?.join("settings.json");
            let settings = load_settings(&path);
            let opacity = settings.opacity;

            // Для проверки с локальным dev-сервером: VOCAB_URL=http://localhost:5173/vocab/?compact=1
            let dev_url = std::env::var("VOCAB_URL").ok();
            // Автозапуск: при каждом старте приводим запись Windows к настройке (и к текущему пути программы).
            // При проверке через VOCAB_URL автозапуск не трогаем.
            if dev_url.is_none() {
                let autolaunch = app.autolaunch();
                let _ = if settings.autostart { autolaunch.enable() } else { autolaunch.disable() };
            }

            // Трей: Показать / Прозрачность ▸ / Запускать вместе с Windows / Выход.
            let current = transparency_of(opacity);
            let levels = TRANSPARENCY_LEVELS
                .iter()
                .map(|&level| {
                    let label = if level == 0 { "Нет".to_string() } else { format!("{level}%") };
                    CheckMenuItem::with_id(app, format!("opacity-{level}"), label, true, level == current, None::<&str>)
                        .map(|item| (level, item))
                })
                .collect::<Result<Vec<_>, _>>()?;
            let level_items: Vec<&dyn IsMenuItem<Wry>> = levels.iter().map(|(_, item)| item as &dyn IsMenuItem<Wry>).collect();
            let opacity_menu = Submenu::with_items(app, "Прозрачность", true, &level_items)?;
            let show = MenuItem::with_id(app, "show", "Показать", true, None::<&str>)?;
            let autostart = CheckMenuItem::with_id(
                app,
                "autostart",
                "Запускать вместе с Windows",
                true,
                settings.autostart,
                None::<&str>,
            )?;
            let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&show, &opacity_menu, &autostart, &separator, &quit])?;

            app.manage(AppState { path, settings: Mutex::new(settings), levels });

            let autostart_item = autostart.clone();
            TrayIconBuilder::with_id("tray")
                .icon(app.default_window_icon().cloned().ok_or("нет иконки")?)
                .tooltip("Словарь — Ctrl+Shift+Space")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "show" => show_window(app),
                    "autostart" => {
                        let autolaunch = app.autolaunch();
                        let enable = !autolaunch.is_enabled().unwrap_or(false);
                        let _ = if enable { autolaunch.enable() } else { autolaunch.disable() };
                        let enabled = autolaunch.is_enabled().unwrap_or(false);
                        app.state::<AppState>().update(|s| s.autostart = enabled);
                        let _ = autostart_item.set_checked(enabled);
                    }
                    "quit" => {
                        let _ = app.save_window_state(window_flags());
                        app.exit(0);
                    }
                    id => {
                        if let Some(level) = id.strip_prefix("opacity-").and_then(|l| l.parse::<u8>().ok()) {
                            apply_opacity(app, f64::from(100 - level) / 100.0, true);
                        }
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // Окно: 360×500, без рамки, прозрачное (прозрачность задаёт страница), всегда поверх.
            // Позицию и размер прошлого запуска плагин window-state вернёт сам при создании окна.
            let url = dev_url.unwrap_or_else(|| SITE_URL.to_string());
            let window = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::External(url.parse()?))
                .title("Словарь")
                .inner_size(360.0, 500.0)
                .min_inner_size(280.0, 320.0)
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .visible(false)
                .center()
                .build()?;

            let handle = app.handle().clone();
            window.on_window_event(move |event| match event {
                // Alt+F4 — прячем, а не закрываем: выход только из трея.
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    if let Some(window) = handle.get_webview_window(MAIN) {
                        let _ = window.hide();
                    }
                }
                WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                    let _ = handle.save_window_state(window_flags());
                }
                _ => {}
            });

            if let Err(err) = app.global_shortcut().register(hotkey) {
                eprintln!("Не удалось занять Ctrl+Shift+Space: {err}");
            }
            show_window(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("не удалось запустить окно словаря");
}
