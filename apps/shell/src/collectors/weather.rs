use crate::state::Host;
use chrono::{Timelike, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, ffi::c_void, ptr, sync::atomic::Ordering, time::Duration};
use windows::{
    core::{w, PCWSTR},
    Win32::Networking::WinHttp::*,
    Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED},
};

struct Internet(*mut c_void);
impl Internet {
    fn new(p: *mut c_void) -> Result<Self, String> {
        if p.is_null() {
            Err(windows::core::Error::from_thread().to_string())
        } else {
            Ok(Self(p))
        }
    }
}
impl Drop for Internet {
    fn drop(&mut self) {
        unsafe {
            let _ = WinHttpCloseHandle(self.0);
        }
    }
}

// Windows supplies HTTPS, certificate validation and the user's system proxy.
// Requests only go to the two named providers, with no system/Agent data.
fn get_json(server: &str, path: &str) -> Result<Value, String> {
    if !["api.open-meteo.com", "geocoding-api.open-meteo.com"].contains(&server) {
        return Err("天气服务地址无效".into());
    }
    let server: Vec<u16> = server.encode_utf16().chain(Some(0)).collect();
    let path: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
    unsafe {
        let session = Internet::new(WinHttpOpen(
            w!("AsciiCity/0.3"),
            WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
            PCWSTR::null(),
            PCWSTR::null(),
            0,
        ))?;
        WinHttpSetTimeouts(session.0, 8000, 8000, 8000, 12000).map_err(|e| e.to_string())?;
        let connection = Internet::new(WinHttpConnect(session.0, PCWSTR(server.as_ptr()), 443, 0))?;
        let request = Internet::new(WinHttpOpenRequest(
            connection.0,
            w!("GET"),
            PCWSTR(path.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            ptr::null(),
            WINHTTP_FLAG_SECURE,
        ))?;
        WinHttpSendRequest(request.0, None, None, 0, 0, 0).map_err(|e| e.to_string())?;
        WinHttpReceiveResponse(request.0, ptr::null_mut()).map_err(|e| e.to_string())?;
        let mut status = 0u32;
        let mut size = 4u32;
        WinHttpQueryHeaders(
            request.0,
            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            PCWSTR::null(),
            Some((&mut status as *mut u32).cast()),
            &mut size,
            ptr::null_mut(),
        )
        .map_err(|e| e.to_string())?;
        if status != 200 {
            return Err(format!("天气服务 HTTP {status}"));
        }
        let mut data = Vec::new();
        let mut block = [0u8; 8192];
        loop {
            let mut read = 0;
            WinHttpReadData(
                request.0,
                block.as_mut_ptr().cast(),
                block.len() as u32,
                &mut read,
            )
            .map_err(|e| e.to_string())?;
            if read == 0 {
                break;
            }
            data.extend_from_slice(&block[..read as usize]);
            if data.len() > 131072 {
                return Err("天气响应过大".into());
            }
        }
        serde_json::from_slice(&data).map_err(|_| "天气数据格式无效".into())
    }
}

fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

fn location(city: &str, scene: &str) -> Result<(String, f64, f64), String> {
    if city == "system" {
        return super::system_location::current();
    }
    let city = if city == "auto" {
        match scene {
            "nyc" => "纽约",
            "hk" => "香港",
            _ => "上海",
        }
    } else {
        city
    };
    let known = match city {
        "上海" => Some((31.2304, 121.4737)),
        "纽约" => Some((40.7128, -74.006)),
        "香港" => Some((22.3193, 114.1694)),
        "北京" => Some((39.9042, 116.4074)),
        "杭州" => Some((30.2741, 120.1551)),
        "深圳" => Some((22.5431, 114.0579)),
        "广州" => Some((23.1291, 113.2644)),
        "成都" => Some((30.5728, 104.0668)),
        _ => None,
    };
    if let Some((lat, lon)) = known {
        return Ok((city.into(), lat, lon));
    }
    let v = get_json(
        "geocoding-api.open-meteo.com",
        &format!(
            "/v1/search?name={}&count=1&language=zh&format=json",
            encode(city)
        ),
    )?;
    let result = &v["results"][0];
    let lat = result["latitude"]
        .as_f64()
        .ok_or("未找到城市，请填写更完整的城市名")?;
    let lon = result["longitude"].as_f64().ok_or("城市坐标无效")?;
    if !lat.is_finite()
        || !lon.is_finite()
        || !(-90.0..=90.0).contains(&lat)
        || !(-180.0..=180.0).contains(&lon)
    {
        return Err("城市坐标无效".into());
    }
    Ok((
        result["name"]
            .as_str()
            .unwrap_or(city)
            .chars()
            .take(64)
            .collect(),
        lat,
        lon,
    ))
}

fn number(v: &Value, key: &str, min: f64, max: f64) -> Result<f64, String> {
    v[key]
        .as_f64()
        .filter(|n| n.is_finite() && *n >= min && *n <= max)
        .ok_or_else(|| format!("天气字段 {key} 无效"))
}
pub fn parse_current(v: &Value, city: &str) -> Result<Value, String> {
    let c = &v["current"];
    let code = number(c, "weather_code", 0.0, 99.0)?;
    if code.fract() != 0.0 {
        return Err("天气代码无效".into());
    }
    let time = number(c, "time", 0.0, 4102444800.0)? as i64;
    let offset = v["utc_offset_seconds"]
        .as_i64()
        .filter(|n| (-86400..=86400).contains(n))
        .ok_or("天气时区无效")?;
    let local = chrono::DateTime::from_timestamp(Utc::now().timestamp() + offset, 0)
        .ok_or("天气时刻无效")?;
    Ok(
        json!({"code":code as u32,"tempC":number(c,"temperature_2m",-100.0,70.0)?,
        "precip":number(c,"precipitation",0.0,2000.0)?,"windKph":number(c,"wind_speed_10m",0.0,500.0)?,
        "windDeg":number(c,"wind_direction_10m",0.0,360.0)?,"cloud":number(c,"cloud_cover",0.0,100.0)?/100.0,
        "humidity":number(c,"relative_humidity_2m",0.0,100.0)?/100.0,
        "city":city,"observedAt":time*1000,"localHour":local.hour() as f64+local.minute() as f64/60.0}),
    )
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Cache {
    key: String,
    fetched_at: i64,
    data: Value,
}

fn valid_cache(c: &Cache) -> bool {
    let v = &c.data;
    let age = Utc::now().timestamp() - c.fetched_at;
    (0..10800).contains(&age)
        && c.key.chars().count() <= 80
        && [
            ("code", 0.0, 99.0),
            ("tempC", -100.0, 70.0),
            ("precip", 0.0, 2000.0),
            ("windKph", 0.0, 500.0),
            ("windDeg", 0.0, 360.0),
            ("cloud", 0.0, 1.0),
            ("humidity", 0.0, 1.0),
            ("observedAt", 0.0, 4102444800000.0),
            ("localHour", 0.0, 24.0),
        ]
        .iter()
        .all(|(k, min, max)| number(v, k, *min, *max).is_ok())
        && v["code"].as_u64().is_some()
        && v["city"]
            .as_str()
            .is_some_and(|s| s.chars().count() <= 64 && !s.chars().any(char::is_control))
}

pub fn run(host: Host) {
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
    let path = host.0.data_dir.join("weather-cache.json");
    let mut cache = HashMap::<String, Cache>::new();
    if let Some(c) = std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice::<Cache>(&b).ok())
    {
        // Cached payloads get the same strict range validation as network data.
        if valid_cache(&c) {
            cache.insert(c.key.clone(), c);
        }
    }
    let mut active = String::new();
    let mut retry_at = 0i64;
    while host.0.running.load(Ordering::Relaxed) {
        let config = host.0.config.lock().unwrap().clone();
        let key = if config.weather_city == "auto" {
            format!("auto:{}", config.scene)
        } else {
            config.weather_city.clone()
        };
        let now = Utc::now().timestamp();
        if !config.weather {
            if !active.is_empty() {
                host.emit("weather", "weather.mode", None, json!({"live":false}));
                active.clear();
            }
            host.status("weather", "已关闭，跟随系统状态变化");
        } else {
            if active != key {
                host.emit("weather", "weather.mode", None, json!({"live":false}));
                if let Some(c) = cache.get(&key).filter(|c| now - c.fetched_at < 10800) {
                    let mut data = c.data.clone();
                    data["localHour"] = json!(
                        (data["localHour"].as_f64().unwrap_or(12.0)
                            + (now - c.fetched_at) as f64 / 3600.0)
                            % 24.0
                    );
                    host.emit("weather", "weather.real", None, data);
                }
                active = key.clone();
                retry_at = 0;
            }
            let fresh = cache.get(&key).is_some_and(|c| now - c.fetched_at < 600);
            if !fresh && now >= retry_at {
                host.status(
                    "weather",
                    if config.weather_city == "system" {
                        "正在读取系统城市和天气"
                    } else {
                        "正在更新在线天气"
                    },
                );
                let result=location(&config.weather_city,&config.scene).and_then(|(name,lat,lon)|{
                    let url=format!("/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m&timezone=auto&timeformat=unixtime&forecast_days=1");
                    get_json("api.open-meteo.com",&url).and_then(|v|parse_current(&v,&name))
                });
                // A city/switch can change while the network is waiting.
                let latest = host.0.config.lock().unwrap().clone();
                if latest.weather
                    && latest.weather_city == config.weather_city
                    && (config.weather_city != "auto" || latest.scene == config.scene)
                {
                    match result {
                        Ok(data) => {
                            let entry = Cache {
                                key: key.clone(),
                                fetched_at: now,
                                data: data.clone(),
                            };
                            if let Ok(bytes) = serde_json::to_vec(&entry) {
                                let _ = std::fs::write(&path, bytes);
                            }
                            cache.insert(key.clone(), entry);
                            host.emit("weather", "weather.real", None, data);
                            retry_at = now + 600;
                        }
                        Err(e) => {
                            let cached =
                                cache.get(&key).is_some_and(|c| now - c.fetched_at < 10800);
                            host.status(
                                "weather",
                                format!(
                                    "{}：{e}",
                                    if cached {
                                        "更新失败，暂用缓存"
                                    } else {
                                        if config.weather_city == "system" {
                                            "系统城市不可用"
                                        } else {
                                            "连接失败，暂随系统变化"
                                        }
                                    }
                                ),
                            );
                            retry_at = now + 120;
                        }
                    }
                }
            }
            if let Some(c) = cache.get(&key).filter(|c| now - c.fetched_at < 10800) {
                if fresh || retry_at == now + 600 {
                    host.status(
                        "weather",
                        format!(
                            "{}{}，{} 分钟前更新，Open-Meteo",
                            c.data["city"].as_str().unwrap_or("城市"),
                            if config.weather_city == "system" {
                                "（系统位置）"
                            } else {
                                ""
                            },
                            (now - c.fetched_at).max(0) / 60
                        ),
                    );
                }
            } else if cache.contains_key(&key) {
                host.emit("weather", "weather.mode", None, json!({"live":false}));
                cache.remove(&key);
            }
        }
        std::thread::sleep(Duration::from_secs(2));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn current_weather_validates_nulls_and_retains_snow_and_city_time() {
        let mut v = json!({"utc_offset_seconds":28800,"current":{"time":1793611800,"weather_code":73,"temperature_2m":-2.0,"precipitation":0.3,"wind_speed_10m":12.0,"wind_direction_10m":270.0,"cloud_cover":90,"relative_humidity_2m":80}});
        let d = parse_current(&v, "上海").unwrap();
        assert_eq!(d["code"], 73);
        assert_eq!(d["cloud"], 0.9);
        assert_eq!(d["city"], "上海");
        v["current"]["temperature_2m"] = Value::Null;
        assert!(parse_current(&v, "上海").is_err());
    }
    #[test]
    fn city_names_are_encoded_as_utf8_query_parameters() {
        assert_eq!(encode("上海 &"), "%E4%B8%8A%E6%B5%B7%20%26");
    }
}
