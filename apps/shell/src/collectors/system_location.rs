use std::sync::OnceLock;
use windows::{
    Devices::Geolocation::{Geolocator, PositionAccuracy, PositionStatus},
    Foundation::TimeSpan,
};

struct City {
    name: &'static str,
    lat: f64,
    lon: f64,
    country: &'static str,
    capital: bool,
}
static CITIES: OnceLock<Vec<City>> = OnceLock::new();

fn cities() -> &'static [City] {
    CITIES.get_or_init(|| {
        include_str!("../../data/cities.tsv")
            .lines()
            .filter_map(|line| {
                let mut fields = line.split('\t');
                Some(City {
                    name: fields.next()?,
                    lat: fields.next()?.parse().ok()?,
                    lon: fields.next()?.parse().ok()?,
                    country: fields.next()?,
                    capital: matches!(fields.next()?, "PPLC" | "PPLA" | "PPLA2"),
                })
            })
            .collect()
    })
}

fn distance_km(lat: f64, lon: f64, city: &City) -> f64 {
    let dlat = (city.lat - lat).to_radians();
    let dlon = (city.lon - lon).to_radians();
    let a = (dlat / 2.0).sin().powi(2)
        + lat.to_radians().cos() * city.lat.to_radians().cos() * (dlon / 2.0).sin().powi(2);
    12742.0 * a.clamp(0.0, 1.0).sqrt().asin()
}

pub fn nearby_city(lat: f64, lon: f64) -> String {
    let all = cities();
    let closest = all
        .iter()
        .map(|c| (c, distance_km(lat, lon, c)))
        .min_by(|a, b| a.1.total_cmp(&b.1));
    let Some((mut city, mut distance)) = closest else {
        return "系统位置".into();
    };
    // In China, prefer the nearby prefectural city over a district/town label.
    if city.country == "CN" {
        if let Some((capital, d)) = all
            .iter()
            .filter(|c| c.country == "CN" && c.capital)
            .map(|c| (c, distance_km(lat, lon, c)))
            .filter(|(_, d)| *d <= 80.0)
            .min_by(|a, b| a.1.total_cmp(&b.1))
        {
            city = capital;
            distance = d;
        }
    }
    if distance > 120.0 {
        return "系统位置".into();
    }
    if distance > 20.0 {
        format!("{}附近", city.name)
    } else {
        city.name.into()
    }
}

pub fn coarse_position(lat: f64, lon: f64) -> Result<(f64, f64), String> {
    if !lat.is_finite()
        || !lon.is_finite()
        || !(-90.0..=90.0).contains(&lat)
        || !(-180.0..=180.0).contains(&lon)
    {
        return Err("Windows 返回的位置无效".into());
    }
    // Only this approximately 10 km grid is sent to the weather provider.
    Ok(((lat * 10.0).round() / 10.0, (lon * 10.0).round() / 10.0))
}

pub fn current() -> Result<(String, f64, f64), String> {
    let position = (|| -> windows::core::Result<(f64, f64, f64)> {
        let locator = Geolocator::new()?;
        locator.SetDesiredAccuracy(PositionAccuracy::Default)?;
        if locator.LocationStatus()? == PositionStatus::Disabled {
            return Err(windows::core::Error::new(
                windows::core::HRESULT(0x80070005u32 as i32),
                "Windows 定位已关闭",
            ));
        }
        let position = locator
            .GetGeopositionAsyncWithAgeAndTimeout(
                TimeSpan {
                    Duration: 300 * 10_000_000,
                },
                TimeSpan {
                    Duration: 12 * 10_000_000,
                },
            )?
            .join()?;
        let coordinate = position.Coordinate()?;
        let point = coordinate.Point()?.Position()?;
        Ok((point.Latitude, point.Longitude, coordinate.Accuracy()?))
    })()
    .map_err(|e| {
        if e.code().0 == 0x80070005u32 as i32 {
            "Windows 定位不可用，请在系统设置中允许桌面应用定位".to_owned()
        } else {
            "暂时无法取得系统位置，请检查 Windows 定位设置".to_owned()
        }
    })?;
    if !position.2.is_finite() || position.2 > 100_000.0 {
        return Err("系统定位范围过大，暂时无法确定城市".into());
    }
    let city = nearby_city(position.0, position.1);
    let (lat, lon) = coarse_position(position.0, position.1)?;
    // City matching stays entirely offline. No separate reverse-geocoding service.
    Ok((city, lat, lon))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn system_position_never_picks_a_capital_from_country_or_timezone() {
        assert!(nearby_city(31.2, 121.5).contains("上海"));
        assert!(nearby_city(32.1, 118.8).contains("南京"));
        assert!(nearby_city(40.7, -74.0).contains("纽约"));
        assert_eq!(nearby_city(-45.0, -130.0), "系统位置");
    }
    #[test]
    fn location_is_rounded_before_leaving_the_process() {
        assert_eq!(coarse_position(31.23456, 121.4789).unwrap(), (31.2, 121.5));
        assert!(coarse_position(f64::NAN, 0.0).is_err());
        assert!(coarse_position(91.0, 0.0).is_err());
    }
}
