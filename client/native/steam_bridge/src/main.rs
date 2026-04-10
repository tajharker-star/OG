use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use steamworks::{
    AppId, Client, Friend, FriendFlags, FriendState, GameLobbyJoinRequested,
    GameOverlayActivated, GameRichPresenceJoinRequested, Leaderboard, LeaderboardDataRequest,
    LeaderboardDisplayType, LeaderboardEntry, LeaderboardSortMethod, LobbyDataUpdate, LobbyId,
    LobbyType, P2PSessionConnectFail, P2PSessionRequest, PersonaStateChange, SendType, SteamId,
    UploadScoreMethod, UserStatsReceived,
};
use std::collections::HashMap;
use std::io::{self, BufRead, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

type JsonMap = Map<String, Value>;

#[derive(Debug, Deserialize)]
struct BridgeRequest {
    #[serde(default)]
    id: Option<String>,
    method: String,
    #[serde(default)]
    params: Value,
}

struct BridgeState {
    client: Client,
    active_lobby: Mutex<Option<LobbyId>>,
    stats_ready: AtomicBool,
    callback_handles: Mutex<Vec<steamworks::CallbackHandle>>,
    writer_tx: mpsc::Sender<Value>,
}

fn main() {
    if let Err(err) = run() {
        emit_fatal_error(&err);
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let app_id = resolve_app_id()?;
    let client = Client::init_app(AppId(app_id)).map_err(|err| format!("{err:?}"))?;
    let (writer_tx, writer_rx) = mpsc::channel::<Value>();
    let state = Arc::new(BridgeState {
        client,
        active_lobby: Mutex::new(None),
        stats_ready: AtomicBool::new(false),
        callback_handles: Mutex::new(Vec::new()),
        writer_tx: writer_tx.clone(),
    });

    let writer_thread = thread::spawn(move || writer_loop(writer_rx));

    register_callbacks(&state)?;
    start_callback_pump(state.clone());

    let current_user = build_current_user(&state);
    emit_event(
        &state.writer_tx,
        "initialized",
        json!({
            "steamId": current_user.steam_id,
            "name": current_user.name,
        }),
    );

    let stdin = io::stdin();
    for line_result in stdin.lock().lines() {
        let line = match line_result {
            Ok(value) => value,
            Err(err) => {
                emit_event(
                    &state.writer_tx,
                    "error",
                    json!({ "message": format!("stdin read error: {err}") }),
                );
                break;
            }
        };

        if line.trim().is_empty() {
            continue;
        }

        let request: BridgeRequest = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(err) => {
                emit_generic_response(
                    &state.writer_tx,
                    None,
                    false,
                    None,
                    Some(format!("invalid request payload: {err}")),
                );
                continue;
            }
        };

        let request_id = request.id.clone();
        let result = handle_request(&state, request);
        match result {
            Ok(response) => {
                if request_id.is_some() {
                    emit_generic_response(&state.writer_tx, request_id, true, Some(response), None);
                }
            }
            Err(err) => {
                if request_id.is_some() {
                    emit_generic_response(&state.writer_tx, request_id, false, None, Some(err));
                } else {
                    emit_event(&state.writer_tx, "error", json!({ "message": err }));
                }
            }
        }
    }

    drop(state);
    drop(writer_tx);
    let _ = writer_thread.join();
    Ok(())
}

fn resolve_app_id() -> Result<u32, String> {
    for key in ["STEAM_APP_ID", "STEAM_APPID", "SteamAppId", "SteamGameId"] {
        if let Ok(value) = std::env::var(key) {
            if let Ok(parsed) = value.trim().parse::<u32>() {
                if parsed > 0 {
                    return Ok(parsed);
                }
            }
        }
    }

    Err("Steam App ID is missing.".into())
}

fn writer_loop(rx: mpsc::Receiver<Value>) {
    let stdout = io::stdout();
    let mut handle = stdout.lock();
    while let Ok(message) = rx.recv() {
        match serde_json::to_string(&message) {
            Ok(line) => {
                let _ = handle.write_all(line.as_bytes());
                let _ = handle.write_all(b"\n");
                let _ = handle.flush();
            }
            Err(err) => {
                let fallback = json!({
                    "type": "event",
                    "event": "error",
                    "payload": { "message": format!("failed to serialize bridge message: {err}") }
                });
                if let Ok(line) = serde_json::to_string(&fallback) {
                    let _ = handle.write_all(line.as_bytes());
                    let _ = handle.write_all(b"\n");
                    let _ = handle.flush();
                }
            }
        }
    }
}

fn emit_fatal_error(message: &str) {
    let payload = json!({
        "type": "event",
        "event": "error",
        "payload": { "message": message },
    });
    if let Ok(line) = serde_json::to_string(&payload) {
        let _ = writeln!(io::stderr(), "{line}");
        let _ = writeln!(io::stdout(), "{line}");
    }
}

fn emit_generic_response(
    tx: &mpsc::Sender<Value>,
    id: Option<String>,
    success: bool,
    result: Option<Value>,
    error: Option<String>,
) {
    let mut payload = JsonMap::new();
    payload.insert("type".into(), Value::String("response".into()));
    if let Some(message_id) = id {
        payload.insert("id".into(), Value::String(message_id));
    }
    payload.insert("success".into(), Value::Bool(success));
    if let Some(value) = result {
        payload.insert("result".into(), value);
    }
    if let Some(value) = error {
        payload.insert("error".into(), Value::String(value));
    }
    let _ = tx.send(Value::Object(payload));
}

fn emit_event(tx: &mpsc::Sender<Value>, event: &str, payload: Value) {
    let _ = tx.send(json!({
        "type": "event",
        "event": event,
        "payload": payload,
    }));
}

fn register_callbacks(state: &Arc<BridgeState>) -> Result<(), String> {
    let mut handles = Vec::new();

    {
        let tx = state.writer_tx.clone();
        handles.push(state.client.register_callback(move |callback: GameLobbyJoinRequested| {
            emit_event(
                &tx,
                "join-lobby-requested",
                json!({
                    "lobbyId": callback.lobby_steam_id.raw().to_string(),
                    "friendSteamId": callback.friend_steam_id.raw().to_string(),
                    "source": "lobby",
                }),
            );
        }));
    }

    {
        let tx = state.writer_tx.clone();
        handles.push(state.client.register_callback(move |callback: GameRichPresenceJoinRequested| {
            if let Some(lobby_id) = extract_lobby_id_from_connect_string(&callback.connect) {
                emit_event(
                    &tx,
                    "join-lobby-requested",
                    json!({
                        "lobbyId": lobby_id,
                        "friendSteamId": callback.friend_steam_id.raw().to_string(),
                        "source": "rich-presence",
                        "connect": callback.connect,
                    }),
                );
            }
        }));
    }

    {
        let tx = state.writer_tx.clone();
        handles.push(state.client.register_callback(move |callback: GameOverlayActivated| {
            emit_event(
                &tx,
                "overlay-activated",
                json!({ "active": callback.active }),
            );
        }));
    }

    {
        let tx = state.writer_tx.clone();
        handles.push(state.client.register_callback(move |callback: LobbyDataUpdate| {
            emit_event(
                &tx,
                "lobby-data-update",
                json!({
                    "lobbyId": callback.lobby.raw().to_string(),
                    "memberSteamId": callback.member.raw().to_string(),
                    "success": callback.success,
                }),
            );
        }));
    }

    {
        let tx = state.writer_tx.clone();
        handles.push(state.client.register_callback(move |callback: PersonaStateChange| {
            emit_event(
                &tx,
                "persona-state-change",
                json!({
                    "steamId": callback.steam_id.raw().to_string(),
                }),
            );
        }));
    }

    {
        let tx = state.writer_tx.clone();
        handles.push(state.client.register_callback(move |callback: P2PSessionRequest| {
            emit_event(
                &tx,
                "p2p-session-request",
                json!({
                    "steamId": callback.remote.raw().to_string(),
                }),
            );
        }));
    }

    {
        let tx = state.writer_tx.clone();
        handles.push(state.client.register_callback(move |callback: P2PSessionConnectFail| {
            emit_event(
                &tx,
                "p2p-session-connect-fail",
                json!({
                    "steamId": callback.remote.raw().to_string(),
                    "error": callback.error,
                }),
            );
        }));
    }

    {
        let tx = state.writer_tx.clone();
        let callback_state = state.clone();
        handles.push(state.client.register_callback(move |callback: UserStatsReceived| {
            if callback.result.is_ok() {
                callback_state.stats_ready.store(true, Ordering::SeqCst);
            }

            emit_event(
                &tx,
                "stats-received",
                json!({
                    "gameId": callback.game_id.raw().to_string(),
                    "steamId": callback.steam_id.raw().to_string(),
                    "success": callback.result.is_ok(),
                }),
            );
        }));
    }

    let mut locked = state
        .callback_handles
        .lock()
        .map_err(|_| "Failed to store callback handles.".to_string())?;
    locked.extend(handles);
    Ok(())
}

fn start_callback_pump(state: Arc<BridgeState>) {
    thread::spawn(move || loop {
        state.client.run_callbacks();
        pump_p2p_packets(&state);
        thread::sleep(Duration::from_millis(16));
    });
}

fn pump_p2p_packets(state: &Arc<BridgeState>) {
    let networking = state.client.networking();
    let mut next_packet_size = networking.is_p2p_packet_available();
    let mut iterations = 0;

    while let Some(packet_size) = next_packet_size {
        if iterations >= 256 {
            break;
        }

        let mut buffer = vec![0_u8; packet_size];
        if let Some((remote, read_size)) = networking.read_p2p_packet(&mut buffer) {
            buffer.truncate(read_size);
            emit_event(
                &state.writer_tx,
                "p2p-packet",
                json!({
                    "steamId": remote.raw().to_string(),
                    "channel": 0,
                    "dataBase64": BASE64.encode(buffer),
                }),
            );
        } else {
            break;
        }

        next_packet_size = networking.is_p2p_packet_available();
        iterations += 1;
    }
}

fn handle_request(state: &Arc<BridgeState>, request: BridgeRequest) -> Result<Value, String> {
    match request.method.as_str() {
        "get_current_user" => Ok(json!({
            "steamId": build_current_user(state).steam_id,
            "name": build_current_user(state).name,
        })),
        "activate_overlay" => {
            let dialog = request
                .params
                .get("dialog")
                .and_then(Value::as_str)
                .unwrap_or("Friends");
            state.client.friends().activate_game_overlay(dialog);
            Ok(json!({ "success": true }))
        }
        "set_rich_presence" => {
            let entries = request
                .params
                .get("entries")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            let friends = state.client.friends();
            for (key, value) in entries {
                match value {
                    Value::Null => {
                        let _ = friends.set_rich_presence(&key, None);
                    }
                    Value::String(string_value) => {
                        let _ = friends.set_rich_presence(&key, Some(&string_value));
                    }
                    other => {
                        let _ = friends.set_rich_presence(&key, Some(&other.to_string()));
                    }
                }
            }
            Ok(json!({ "success": true }))
        }
        "create_lobby" => handle_create_lobby(state, &request.params),
        "list_lobbies" => handle_list_lobbies(state, &request.params),
        "get_lobby_data" => handle_get_lobby_data(state, &request.params),
        "open_invite_dialog" => handle_open_invite_dialog(state, &request.params),
        "list_friends" => handle_list_friends(state),
        "invite_friend" => handle_invite_friend(state, &request.params),
        "leave_lobby" => handle_leave_lobby(state, &request.params),
        "update_active_lobby_data" => handle_update_active_lobby_data(state, &request.params),
        "get_stats" => handle_get_stats(state, &request.params),
        "set_stats" => handle_set_stats(state, &request.params),
        "get_leaderboard_snapshot" => handle_get_leaderboard_snapshot(state, &request.params),
        "set_leaderboard_score" => handle_set_leaderboard_score(state, &request.params),
        "activate_achievement" => handle_activate_achievement(state, &request.params),
        "accept_p2p_session" => {
            let steam_id = require_steam_id(&request.params, "steamId")?;
            let accepted = state.client.networking().accept_p2p_session(steam_id);
            Ok(json!({ "success": accepted }))
        }
        "send_p2p_packet" => handle_send_p2p_packet(state, &request.params),
        "close_p2p_session" => {
            let steam_id = require_steam_id(&request.params, "steamId")?;
            let closed = state.client.networking().close_p2p_session(steam_id);
            Ok(json!({ "success": closed }))
        }
        other => Err(format!("Unsupported Steam bridge method: {other}")),
    }
}

fn handle_create_lobby(state: &Arc<BridgeState>, params: &Value) -> Result<Value, String> {
    let lobby_type = params
        .get("lobbyVisibility")
        .and_then(Value::as_str)
        .map(parse_lobby_type)
        .unwrap_or(LobbyType::FriendsOnly);
    let max_members = params
        .get("maxMembers")
        .and_then(Value::as_u64)
        .unwrap_or(10)
        .clamp(2, 250) as u32;
    let matchmaking = state.client.matchmaking();
    let (tx, rx) = mpsc::channel();

    matchmaking.create_lobby(lobby_type, max_members, move |result| {
        let _ = tx.send(result.map_err(|err| format!("{err:?}")));
    });

    let lobby_id = rx
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "Timed out while creating Steam lobby.".to_string())?
        .map_err(|err| err)?;
    remember_active_lobby(state, Some(lobby_id))?;
    let endpoint = params
        .get("endpoint")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string);
    let room_id = params
        .get("roomId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let map = params
        .get("map")
        .and_then(Value::as_str)
        .unwrap_or("Unknown")
        .to_string();
    let mode = params
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("Standard")
        .to_string();
    let metadata = params
        .get("metadata")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let local_steam_id = state.client.user().steam_id().raw().to_string();

    let matchmaking = state.client.matchmaking();
    let _ = matchmaking.set_lobby_joinable(lobby_id, true);
    let mut full_metadata = HashMap::<String, String>::new();
    full_metadata.insert("ag_room".into(), room_id);
    full_metadata.insert("map".into(), map);
    full_metadata.insert("mode".into(), mode);
    full_metadata.insert("ag_host_steam_id".into(), local_steam_id);
    full_metadata.insert("ag_transport".into(), "steamrelay".into());
    if let Some(endpoint_value) = endpoint.clone() {
        full_metadata.insert("ag_endpoint".into(), endpoint_value);
    }
    for (key, value) in metadata {
        if let Some(string_value) = normalize_metadata_value(&value) {
            full_metadata.insert(key, string_value);
        }
    }
    if !full_metadata.contains_key("ag_status") {
        full_metadata.insert("ag_status".into(), "waiting".into());
    }
    apply_lobby_metadata(&matchmaking, lobby_id, &full_metadata);

    Ok(json!({
        "success": true,
        "lobbyId": lobby_id.raw().to_string(),
        "endpoint": endpoint,
    }))
}

fn handle_list_lobbies(state: &Arc<BridgeState>, params: &Value) -> Result<Value, String> {
    let expected_queue_type = params.get("queueType").and_then(Value::as_str);
    let expected_status = params.get("status").and_then(Value::as_str);
    let require_open_slot = params
        .get("requireOpenSlot")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let max_results = params
        .get("maxResults")
        .and_then(Value::as_u64)
        .unwrap_or(20)
        .clamp(1, 50) as usize;

    let matchmaking = state.client.matchmaking();
    let (tx, rx) = mpsc::channel();
    matchmaking.request_lobby_list(move |result| {
        let _ = tx.send(result.map_err(|err| format!("{err:?}")));
    });

    let lobbies = rx
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "Timed out while listing Steam lobbies.".to_string())?
        .map_err(|err| err)?;
    let mut snapshots: Vec<Value> = lobbies
        .into_iter()
        .map(|lobby_id| build_lobby_snapshot(state, lobby_id))
        .filter(|snapshot| {
            let room_id = snapshot.get("roomId").and_then(Value::as_str).unwrap_or_default();
            let endpoint = snapshot.get("endpoint").and_then(Value::as_str);
            let host_steam_id = snapshot.get("hostSteamId").and_then(Value::as_str);
            !room_id.is_empty() && (endpoint.is_some() || host_steam_id.is_some())
        })
        .filter(|snapshot| {
            expected_queue_type
                .map(|expected| snapshot.get("queueType").and_then(Value::as_str) == Some(expected))
                .unwrap_or(true)
        })
        .filter(|snapshot| {
            expected_status
                .map(|expected| snapshot.get("status").and_then(Value::as_str) == Some(expected))
                .unwrap_or(true)
        })
        .filter(|snapshot| {
            if !require_open_slot {
                return true;
            }

            let member_limit = snapshot.get("memberLimit").and_then(Value::as_u64).unwrap_or(0);
            let required_players = snapshot
                .get("requiredPlayers")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let capacity = if member_limit > 0 { member_limit } else { required_players };
            if capacity == 0 {
                return true;
            }
            snapshot
                .get("memberCount")
                .and_then(Value::as_u64)
                .unwrap_or(0)
                < capacity
        })
        .collect();

    snapshots.sort_by(|left, right| {
        let left_count = left.get("memberCount").and_then(Value::as_u64).unwrap_or(0);
        let right_count = right.get("memberCount").and_then(Value::as_u64).unwrap_or(0);
        right_count
            .cmp(&left_count)
            .then_with(|| {
                let left_lobby = left.get("lobbyId").and_then(Value::as_str).unwrap_or_default();
                let right_lobby = right.get("lobbyId").and_then(Value::as_str).unwrap_or_default();
                left_lobby.cmp(right_lobby)
            })
    });
    snapshots.truncate(max_results);

    Ok(json!({
        "success": true,
        "lobbies": snapshots,
    }))
}

fn handle_get_lobby_data(state: &Arc<BridgeState>, params: &Value) -> Result<Value, String> {
    let lobby_id = require_lobby_id(params, "lobbyId")?;
    ensure_active_lobby(state, lobby_id)?;

    let started = Instant::now();
    let timeout = Duration::from_secs(6);
    loop {
        let snapshot = build_lobby_snapshot(state, lobby_id);
        let room_id = snapshot.get("roomId").and_then(Value::as_str).unwrap_or_default();
        let endpoint = snapshot.get("endpoint").and_then(Value::as_str);
        let host_steam_id = snapshot.get("hostSteamId").and_then(Value::as_str);
        if !room_id.is_empty() && (endpoint.is_some() || host_steam_id.is_some()) {
            let mut object = snapshot.as_object().cloned().unwrap_or_default();
            object.insert("success".into(), Value::Bool(true));
            return Ok(Value::Object(object));
        }

        if started.elapsed() >= timeout {
            let mut object = snapshot.as_object().cloned().unwrap_or_default();
            object.insert("success".into(), Value::Bool(false));
            object.insert(
                "error".into(),
                Value::String(
                    "Steam lobby metadata is not available yet. Please try the invite again in a moment."
                        .into(),
                ),
            );
            return Ok(Value::Object(object));
        }

        thread::sleep(Duration::from_millis(200));
    }
}

fn handle_open_invite_dialog(state: &Arc<BridgeState>, params: &Value) -> Result<Value, String> {
    let lobby_id = if params.get("lobbyId").is_some() {
        ensure_active_lobby(state, require_lobby_id(params, "lobbyId")?)?
    } else {
        active_lobby(state)?.ok_or_else(|| "No active Steam lobby is available to invite from.".to_string())?
    };
    state.client.friends().activate_invite_dialog(lobby_id);
    Ok(json!({
        "success": true,
        "method": "native-overlay-invite-dialog",
        "note": "Requested the native Steam invite dialog for the current lobby.",
    }))
}

fn handle_list_friends(state: &Arc<BridgeState>) -> Result<Value, String> {
    let friends_api = state.client.friends();
    let mut friends = friends_api.get_friends(FriendFlags::IMMEDIATE);
    friends.sort_by(|left, right| {
        let left_online = is_online_friend(left);
        let right_online = is_online_friend(right);
        right_online
            .cmp(&left_online)
            .then_with(|| left.name().cmp(&right.name()))
    });

    let payload: Vec<Value> = friends
        .into_iter()
        .map(|friend| build_friend_snapshot(&friend))
        .collect();
    Ok(json!({
        "success": true,
        "friends": payload,
    }))
}

fn handle_invite_friend(state: &Arc<BridgeState>, params: &Value) -> Result<Value, String> {
    let friend_id = require_steam_id(params, "friendSteamId")?;
    let lobby_id = if params.get("lobbyId").is_some() {
        ensure_active_lobby(state, require_lobby_id(params, "lobbyId")?)?
    } else {
        active_lobby(state)?.ok_or_else(|| "No active Steam lobby is available to invite from.".to_string())?
    };

    let invited = unsafe {
        let matchmaking = steamworks_sys::SteamAPI_SteamMatchmaking_v009();
        if matchmaking.is_null() {
            false
        } else {
            steamworks_sys::SteamAPI_ISteamMatchmaking_InviteUserToLobby(
                matchmaking,
                lobby_id.raw(),
                friend_id.raw(),
            )
        }
    };

    if !invited {
        return Err(format!(
            "Steam rejected InviteUserToLobby for friend {} and lobby {}.",
            friend_id.raw(),
            lobby_id.raw(),
        ));
    }

    Ok(json!({
        "success": true,
        "method": "invite-user-to-lobby",
        "note": "Sent a native Steam lobby invite using ISteamMatchmaking::InviteUserToLobby.",
    }))
}

fn handle_leave_lobby(state: &Arc<BridgeState>, params: &Value) -> Result<Value, String> {
    let requested_lobby = if params.get("lobbyId").is_some() {
        Some(require_lobby_id(params, "lobbyId")?)
    } else {
        None
    };
    let active = active_lobby(state)?;
    if let Some(active_lobby_id) = active {
        if requested_lobby.map(|value| value.raw()) == Some(active_lobby_id.raw()) || requested_lobby.is_none() {
            state.client.matchmaking().leave_lobby(active_lobby_id);
            remember_active_lobby(state, None)?;
        }
    }
    Ok(json!({ "success": true }))
}

fn handle_update_active_lobby_data(state: &Arc<BridgeState>, params: &Value) -> Result<Value, String> {
    let lobby_id = active_lobby(state)?.ok_or_else(|| "No active Steam lobby is available to update.".to_string())?;
    let metadata = params
        .get("metadata")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let matchmaking = state.client.matchmaking();
    for (key, value) in metadata {
        if let Some(normalized) = normalize_metadata_value(&value) {
            let _ = matchmaking.set_lobby_data(lobby_id, &key, &normalized);
        } else {
            let _ = matchmaking.delete_lobby_data(lobby_id, &key);
        }
    }
    Ok(json!({ "success": true }))
}

fn handle_get_stats(state: &Arc<BridgeState>, params: &Value) -> Result<Value, String> {
    ensure_current_stats(state, Duration::from_secs(5))?;
    let stat_names = params
        .get("statNames")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let user_stats = state.client.user_stats();
    let mut stats = JsonMap::new();
    for stat_name in stat_names.iter().filter_map(Value::as_str) {
        match user_stats.get_stat_i32(stat_name) {
            Ok(value) => {
                stats.insert(stat_name.to_string(), json!(value));
            }
            Err(_) => {
                stats.insert(stat_name.to_string(), Value::Null);
            }
        }
    }
    Ok(json!({
        "success": true,
        "stats": Value::Object(stats),
    }))
}

fn handle_set_stats(state: &Arc<BridgeState>, params: &Value) -> Result<Value, String> {
    ensure_current_stats(state, Duration::from_secs(5))?;
    let stat_map = params
        .get("stats")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let user_stats = state.client.user_stats();
    let mut rejected = Vec::<String>::new();
    for (key, value) in &stat_map {
        let normalized = value
            .as_i64()
            .or_else(|| value.as_u64().map(|number| number as i64))
            .ok_or_else(|| "Steam stat updates must be numeric.".to_string())?;
        if user_stats.set_stat_i32(key, normalized as i32).is_err() {
            rejected.push(key.clone());
        }
    }
    let stored = rejected.len() < stat_map.len() && user_stats.store_stats().is_ok();
    Ok(json!({
        "success": true,
        "stored": stored,
        "rejected": rejected,
    }))
}

fn handle_activate_achievement(state: &Arc<BridgeState>, params: &Value) -> Result<Value, String> {
    ensure_current_stats(state, Duration::from_secs(5))?;
    let achievement_id = params
        .get("achievementId")
        .and_then(Value::as_str)
        .ok_or_else(|| "achievementId is required.".to_string())?;
    let user_stats = state.client.user_stats();
    user_stats
        .achievement(achievement_id)
        .set()
        .map_err(|_| format!("Failed to activate Steam achievement {achievement_id}."))?;
    user_stats
        .store_stats()
        .map_err(|_| format!("Failed to store Steam achievement {achievement_id}."))?;
    Ok(json!({ "success": true }))
}

fn parse_leaderboard_sort_method(value: Option<&str>) -> LeaderboardSortMethod {
    match value.map(|raw| raw.trim().to_ascii_lowercase()) {
        Some(normalized) if normalized == "ascending" => LeaderboardSortMethod::Ascending,
        _ => LeaderboardSortMethod::Descending,
    }
}

fn parse_leaderboard_display_type(value: Option<&str>) -> LeaderboardDisplayType {
    match value.map(|raw| raw.trim().to_ascii_lowercase()) {
        Some(normalized) if normalized == "time_seconds" => LeaderboardDisplayType::TimeSeconds,
        Some(normalized) if normalized == "time_milliseconds" => LeaderboardDisplayType::TimeMilliSeconds,
        _ => LeaderboardDisplayType::Numeric,
    }
}

fn parse_leaderboard_upload_method(value: Option<&str>) -> UploadScoreMethod {
    match value.map(|raw| raw.trim().to_ascii_lowercase()) {
        Some(normalized) if normalized == "force_update" => UploadScoreMethod::ForceUpdate,
        _ => UploadScoreMethod::KeepBest,
    }
}

fn find_or_create_leaderboard_sync(
    state: &Arc<BridgeState>,
    name: &str,
    sort_method: LeaderboardSortMethod,
    display_type: LeaderboardDisplayType,
    timeout: Duration,
) -> Result<Leaderboard, String> {
    let (tx, rx) = mpsc::channel();
    state
        .client
        .user_stats()
        .find_or_create_leaderboard(name, sort_method, display_type, move |result| {
            let _ = tx.send(result.map_err(|err| format!("{err:?}")));
        });

    let maybe = rx
        .recv_timeout(timeout)
        .map_err(|_| format!("Timed out while resolving Steam leaderboard {name}."))?
        .map_err(|err| err)?;

    maybe.ok_or_else(|| format!("Steam did not return leaderboard {name}."))
}

fn download_leaderboard_entries_sync(
    state: &Arc<BridgeState>,
    leaderboard: &Leaderboard,
    request: LeaderboardDataRequest,
    start: usize,
    end: usize,
    max_details_len: usize,
    timeout: Duration,
) -> Result<Vec<LeaderboardEntry>, String> {
    let (tx, rx) = mpsc::channel();
    state.client.user_stats().download_leaderboard_entries(
        leaderboard,
        request,
        start,
        end,
        max_details_len,
        move |result| {
            let _ = tx.send(result.map_err(|err| format!("{err:?}")));
        },
    );

    rx.recv_timeout(timeout)
        .map_err(|_| "Timed out while downloading Steam leaderboard entries.".to_string())?
        .map_err(|err| err)
}

fn resolve_persona_name(state: &Arc<BridgeState>, steam_id: SteamId) -> String {
    let friends = state.client.friends();
    let _ = friends.request_user_information(steam_id, true);
    let friend = friends.get_friend(steam_id);
    let name = friend.name();
    if name.trim().is_empty() {
        steam_id.raw().to_string()
    } else {
        name
    }
}

fn leaderboard_entry_to_json(state: &Arc<BridgeState>, entry: &LeaderboardEntry) -> Value {
    json!({
        "rank": entry.global_rank,
        "score": entry.score,
        "steamId": entry.user.raw().to_string(),
        "name": resolve_persona_name(state, entry.user),
    })
}

fn handle_get_leaderboard_snapshot(state: &Arc<BridgeState>, params: &Value) -> Result<Value, String> {
    ensure_current_stats(state, Duration::from_secs(5))?;
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Leaderboard name is required.".to_string())?;
    let top_count = params
        .get("topCount")
        .and_then(Value::as_u64)
        .unwrap_or(10)
        .clamp(1, 50) as usize;
    let sort_method = parse_leaderboard_sort_method(params.get("sortMethod").and_then(Value::as_str));
    let display_type = parse_leaderboard_display_type(params.get("displayType").and_then(Value::as_str));

    let leaderboard = find_or_create_leaderboard_sync(
        state,
        name,
        sort_method,
        display_type,
        Duration::from_secs(10),
    )?;

    let total_entries = state
        .client
        .user_stats()
        .get_leaderboard_entry_count(&leaderboard)
        .max(0) as usize;

    let visible_count = total_entries.min(top_count);
    let top_entries = if visible_count > 0 {
        download_leaderboard_entries_sync(
            state,
            &leaderboard,
            LeaderboardDataRequest::Global,
            0,
            visible_count - 1,
            0,
            Duration::from_secs(10),
        )?
    } else {
        Vec::new()
    };

    let current_user = state.client.user().steam_id();
    let mut player_entry = top_entries
        .iter()
        .find(|entry| entry.user == current_user)
        .cloned();

    if player_entry.is_none() && total_entries > visible_count {
        let scan_limit = total_entries.min(2000);
        if scan_limit > 0 {
            let scanned = download_leaderboard_entries_sync(
                state,
                &leaderboard,
                LeaderboardDataRequest::Global,
                0,
                scan_limit - 1,
                0,
                Duration::from_secs(12),
            )?;
            player_entry = scanned.into_iter().find(|entry| entry.user == current_user);
        }
    }

    Ok(json!({
        "success": true,
        "name": name,
        "totalEntries": total_entries as u64,
        "entries": top_entries
            .iter()
            .map(|entry| leaderboard_entry_to_json(state, entry))
            .collect::<Vec<_>>(),
        "playerEntry": player_entry
            .as_ref()
            .map(|entry| leaderboard_entry_to_json(state, entry))
            .unwrap_or(Value::Null),
    }))
}

fn handle_set_leaderboard_score(state: &Arc<BridgeState>, params: &Value) -> Result<Value, String> {
    ensure_current_stats(state, Duration::from_secs(5))?;
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Leaderboard name is required.".to_string())?;
    let score = params
        .get("score")
        .and_then(Value::as_i64)
        .or_else(|| params.get("score").and_then(Value::as_u64).map(|value| value as i64))
        .ok_or_else(|| "Leaderboard score must be numeric.".to_string())?;
    let normalized_score = score.clamp(i32::MIN as i64, i32::MAX as i64) as i32;
    let sort_method = parse_leaderboard_sort_method(params.get("sortMethod").and_then(Value::as_str));
    let display_type = parse_leaderboard_display_type(params.get("displayType").and_then(Value::as_str));
    let upload_method = parse_leaderboard_upload_method(params.get("uploadMethod").and_then(Value::as_str));

    let leaderboard = find_or_create_leaderboard_sync(
        state,
        name,
        sort_method,
        display_type,
        Duration::from_secs(10),
    )?;

    let (tx, rx) = mpsc::channel();
    state.client.user_stats().upload_leaderboard_score(
        &leaderboard,
        upload_method,
        normalized_score,
        &[],
        move |result| {
            let _ = tx.send(result.map_err(|err| format!("{err:?}")));
        },
    );

    let upload_result = rx
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "Timed out while uploading Steam leaderboard score.".to_string())?
        .map_err(|err| err)?;

    match upload_result {
        Some(value) => Ok(json!({
            "success": true,
            "name": name,
            "score": value.score,
            "rank": value.global_rank_new,
            "previousRank": value.global_rank_previous,
            "changed": value.was_changed,
        })),
        None => Ok(json!({
            "success": false,
            "name": name,
            "error": "Steam did not accept the leaderboard score update.",
        })),
    }
}

fn handle_send_p2p_packet(state: &Arc<BridgeState>, params: &Value) -> Result<Value, String> {
    let steam_id = require_steam_id(params, "steamId")?;
    let send_type = match params.get("sendType").and_then(Value::as_i64).unwrap_or(2) {
        0 => SendType::Unreliable,
        1 => SendType::UnreliableNoDelay,
        3 => SendType::ReliableWithBuffering,
        _ => SendType::Reliable,
    };
    let encoded = params
        .get("dataBase64")
        .and_then(Value::as_str)
        .ok_or_else(|| "dataBase64 is required.".to_string())?;
    let payload = BASE64
        .decode(encoded.as_bytes())
        .map_err(|err| format!("Invalid p2p packet payload: {err}"))?;
    let sent = state
        .client
        .networking()
        .send_p2p_packet(steam_id, send_type, &payload);
    Ok(json!({ "success": sent }))
}

fn build_lobby_snapshot(state: &Arc<BridgeState>, lobby_id: LobbyId) -> Value {
    let matchmaking = state.client.matchmaking();
    let data_count = matchmaking.lobby_data_count(lobby_id);
    let mut data = HashMap::<String, String>::new();
    for index in 0..data_count {
        if let Some((key, value)) = matchmaking.lobby_data_by_index(lobby_id, index) {
            data.insert(key, value);
        }
    }
    let required_players = data
        .get("ag_required_players")
        .and_then(|value| value.parse::<u64>().ok());
    let member_limit = matchmaking.lobby_member_limit(lobby_id).map(|value| value as u64);
    json!({
        "lobbyId": lobby_id.raw().to_string(),
        "roomId": data.get("ag_room").cloned(),
        "endpoint": data.get("ag_endpoint").cloned(),
        "hostSteamId": data.get("ag_host_steam_id").cloned(),
        "map": data.get("map").cloned(),
        "mode": data.get("mode").cloned(),
        "queueType": data.get("ag_queue").cloned(),
        "status": data.get("ag_status").cloned(),
        "ranked": data
            .get("ag_ranked")
            .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
            .unwrap_or(false),
        "requiredPlayers": required_players,
        "memberCount": matchmaking.lobby_member_count(lobby_id) as u64,
        "memberLimit": member_limit,
    })
}

fn build_friend_snapshot(friend: &Friend) -> Value {
    let current_game = friend.game_played();
    json!({
        "steamId": friend.id().raw().to_string(),
        "name": friend.name(),
        "nickname": friend.nick_name(),
        "state": friend_state_label(friend.state()),
        "isOnline": is_online_friend(friend),
        "gameAppId": current_game.as_ref().map(|game| game.game.raw().to_string()),
        "lobbyId": current_game.as_ref().map(|game| game.lobby.raw().to_string()),
    })
}

fn build_current_user(state: &Arc<BridgeState>) -> CurrentUser {
    CurrentUser {
        steam_id: state.client.user().steam_id().raw().to_string(),
        name: state.client.friends().name(),
    }
}

fn ensure_current_stats(state: &Arc<BridgeState>, timeout: Duration) -> Result<(), String> {
    if state.stats_ready.load(Ordering::SeqCst) {
        return Ok(());
    }

    let current_user_id = state.client.user().steam_id().raw();
    unsafe {
        let user_stats = steamworks_sys::SteamAPI_SteamUserStats_v013();
        if user_stats.is_null() {
            return Err("Steam user stats interface is unavailable.".into());
        }
        let api_call = steamworks_sys::SteamAPI_ISteamUserStats_RequestUserStats(
            user_stats,
            current_user_id,
        );
        if api_call == 0 {
            return Err("Steam rejected the current stats request.".into());
        }
    }

    let started = Instant::now();
    while started.elapsed() < timeout {
        if state.stats_ready.load(Ordering::SeqCst) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(50));
    }

    Err("Timed out while waiting for Steam stats.".into())
}

fn extract_lobby_id_from_connect_string(connect: &str) -> Option<String> {
    let mut parts = connect.split_whitespace().peekable();
    while let Some(part) = parts.next() {
        if part == "+connect_lobby" {
            return parts.next().map(|value| value.trim().to_string());
        }
    }
    None
}

fn normalize_metadata_value(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(string_value) => {
            if string_value.trim().is_empty() {
                None
            } else {
                Some(string_value.clone())
            }
        }
        Value::Bool(boolean_value) => Some(if *boolean_value { "1".into() } else { "0".into() }),
        Value::Number(number_value) => Some(number_value.to_string()),
        other => Some(other.to_string()),
    }
}

fn apply_lobby_metadata(
    matchmaking: &steamworks::Matchmaking,
    lobby_id: LobbyId,
    metadata: &HashMap<String, String>,
) {
    for (key, value) in metadata {
        let _ = matchmaking.set_lobby_data(lobby_id, key, value);
    }
}

fn parse_lobby_type(value: &str) -> LobbyType {
    match value.trim().to_lowercase().as_str() {
        "private" => LobbyType::Private,
        "public" => LobbyType::Public,
        "invisible" => LobbyType::Invisible,
        _ => LobbyType::FriendsOnly,
    }
}

fn friend_state_label(state: FriendState) -> &'static str {
    match state {
        FriendState::Offline => "offline",
        FriendState::Online => "online",
        FriendState::Busy => "busy",
        FriendState::Away => "away",
        FriendState::Snooze => "snooze",
        FriendState::LookingToPlay => "looking_to_play",
        FriendState::LookingToTrade => "looking_to_trade",
    }
}

fn is_online_friend(friend: &Friend) -> bool {
    !matches!(friend.state(), FriendState::Offline)
}

fn remember_active_lobby(state: &Arc<BridgeState>, lobby: Option<LobbyId>) -> Result<(), String> {
    let mut locked = state
        .active_lobby
        .lock()
        .map_err(|_| "Failed to update the active Steam lobby.".to_string())?;
    *locked = lobby;
    Ok(())
}

fn active_lobby(state: &Arc<BridgeState>) -> Result<Option<LobbyId>, String> {
    let locked = state
        .active_lobby
        .lock()
        .map_err(|_| "Failed to read the active Steam lobby.".to_string())?;
    Ok(*locked)
}

fn ensure_active_lobby(state: &Arc<BridgeState>, lobby_id: LobbyId) -> Result<LobbyId, String> {
    if active_lobby(state)?.map(|value| value.raw()) == Some(lobby_id.raw()) {
        return Ok(lobby_id);
    }

    let matchmaking = state.client.matchmaking();
    let (tx, rx) = mpsc::channel();
    matchmaking.join_lobby(lobby_id, move |result| {
        let _ = tx.send(result.map_err(|_| "Failed to join Steam lobby.".to_string()));
    });

    let joined_lobby = rx
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "Timed out while joining Steam lobby.".to_string())?
        .map_err(|err| err)?;
    remember_active_lobby(state, Some(joined_lobby))?;
    Ok(joined_lobby)
}

fn require_lobby_id(params: &Value, key: &str) -> Result<LobbyId, String> {
    let raw_value = params
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{key} is required."))?;
    let parsed = raw_value
        .trim()
        .parse::<u64>()
        .map_err(|_| format!("Invalid Steam lobby id: {raw_value}"))?;
    Ok(LobbyId::from_raw(parsed))
}

fn require_steam_id(params: &Value, key: &str) -> Result<SteamId, String> {
    let raw_value = params
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{key} is required."))?;
    let parsed = raw_value
        .trim()
        .parse::<u64>()
        .map_err(|_| format!("Invalid Steam ID: {raw_value}"))?;
    Ok(SteamId::from_raw(parsed))
}

#[derive(Clone)]
struct CurrentUser {
    steam_id: String,
    name: String,
}
