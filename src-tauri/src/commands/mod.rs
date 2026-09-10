// Tauri 前端 IPC 交互指令集入口与集中注册
pub mod discovery_cmd;
pub mod fs_cmd;
pub mod transfer_cmd;
pub mod db_cmd;
pub mod system_cmd;

use tauri::generate_handler;

pub fn get_handlers() -> impl Fn(tauri::ipc::Invoke) -> bool {
    generate_handler![
        system_cmd::set_download_dir,
        discovery_cmd::get_local_device,
        discovery_cmd::sync_local_device,
        discovery_cmd::update_local_device,
        discovery_cmd::trigger_discovery_scan,
        discovery_cmd::probe_peer_ip,
        fs_cmd::get_sys_info,
        fs_cmd::check_file_exists,
        fs_cmd::delete_file_from_disk,
        fs_cmd::delete_files_from_disk,
        fs_cmd::read_media_data_url,
        fs_cmd::get_media_dir,
        fs_cmd::save_media_file_to_disk,
        fs_cmd::save_media_from_path,
        transfer_cmd::send_chat_message,
        transfer_cmd::start_file_transfer,
        transfer_cmd::transfer_file_data,
        transfer_cmd::get_partial_file_size,
        fs_cmd::open_in_folder,
        system_cmd::set_auto_start,
        fs_cmd::select_directory,
        system_cmd::register_global_hotkey,
        db_cmd::db_get_all_settings,
        fs_cmd::save_file_to_disk,
        db_cmd::db_save_all_settings,
        db_cmd::db_get_kv,
        db_cmd::db_set_kv,
        db_cmd::db_save_chat_message,
        db_cmd::db_delete_chat_message,
        db_cmd::db_delete_chat_messages,
        db_cmd::db_clear_chat_by_peer,
        db_cmd::db_delete_transfer,
        db_cmd::db_get_all_chat_messages,
        db_cmd::db_get_chat_messages_by_peer,
        db_cmd::db_save_transfer,
        db_cmd::db_get_all_transfers,
        db_cmd::db_clear_all_history,
        system_cmd::request_notification_permission,
        system_cmd::show_system_notification,
        system_cmd::is_window_visible,
        system_cmd::exit_app,
        system_cmd::hide_to_tray,
        system_cmd::show_from_tray,
        system_cmd::toggle_window,
        system_cmd::check_for_updates,
    ]
}
