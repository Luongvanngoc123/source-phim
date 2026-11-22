use avs_direct_m3u8::build_direct_cdn_m3u8;
use std::env;
use std::fs;
use std::time::Instant;

fn main() {
    let args: Vec<String> = env::args().collect();
    let target_url = args.get(1).map(|s| s.as_str()).unwrap_or(
        "https://stream.googleapiscdn.com/player/225a9b1cda0dbe429acb3283d030bba90a2195d755376c99d30fbb70c84a5a06",
    );
    let out_file = args
        .get(2)
        .map(|s| s.as_str())
        .unwrap_or("direct_cdn_playlist.m3u8");

    let start = Instant::now();
    match build_direct_cdn_m3u8(target_url, true) {
        Ok(res) => {
            let elapsed = start.elapsed();
            if let Err(e) = fs::write(out_file, &res.m3u8) {
                eprintln!("[ERR] Failed to write {out_file}: {e}");
                std::process::exit(1);
            }
            println!("[OK] Player ID    : {}", res.player_id);
            println!(
                "[OK] Segments     : {} direct lh3.googleusercontent.com links",
                res.segment_count
            );
            println!(
                "[OK] Inline Key   : {}",
                res.seg_key_data_uri.as_deref().unwrap_or("none")
            );
            println!(
                "[OK] Saved M3U8   : {} ({} bytes) in {:.2?}",
                out_file,
                res.m3u8.len(),
                elapsed
            );
        }
        Err(err) => {
            eprintln!("[ERR] Extraction failed: {err}");
            std::process::exit(1);
        }
    }
}
