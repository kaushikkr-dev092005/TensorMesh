//! Read-only loopback host for the existing sandboxed code-preview relay.
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::{self, JoinHandle},
    time::Duration,
};
const RELAY: &str = include_str!("../../../harness/preview-relay.html");
const CSP: &str = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'unsafe-inline' data: https://fonts.googleapis.com; font-src data: https://fonts.gstatic.com; img-src data: blob:; media-src data: blob:; connect-src data: blob:; worker-src blob: data:; frame-src 'self' blob: data:";
pub struct PreviewHost {
    pub origin: String,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}
impl PreviewHost {
    pub fn start() -> std::io::Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", 0))?;
        let address = listener.local_addr()?;
        listener.set_nonblocking(true)?;
        let stop = Arc::new(AtomicBool::new(false));
        let signal = stop.clone();
        let host = address.to_string();
        let worker = thread::spawn(move || {
            while !signal.load(Ordering::Acquire) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        if let Err(error) = respond(stream, &host) {
                            eprintln!("Preview relay request failed: {error}");
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10))
                    }
                    Err(error) => {
                        eprintln!("Preview relay listener failed: {error}");
                        break;
                    }
                }
            }
        });
        Ok(Self {
            origin: format!("http://{address}"),
            stop,
            worker: Some(worker),
        })
    }
}
impl Drop for PreviewHost {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            if worker.join().is_err() {
                eprintln!("Preview relay worker panicked");
            }
        }
    }
}
fn respond(mut stream: TcpStream, host: &str) -> std::io::Result<()> {
    // Windows accepted sockets inherit the listener's nonblocking mode.
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(Duration::from_millis(500)))?;
    stream.set_write_timeout(Some(Duration::from_millis(500)))?;
    let mut request = Vec::new();
    let mut chunk = [0u8; 512];
    while request.len() < 4096 && !request.windows(4).any(|w| w == b"\r\n\r\n") {
        let count = stream.read(&mut chunk)?;
        if count == 0 {
            break;
        }
        request.extend_from_slice(&chunk[..count]);
    }
    let text = String::from_utf8_lossy(&request);
    let valid_host = text.lines().skip(1).any(|line| {
        line.split_once(':')
            .is_some_and(|(name, value)| name.eq_ignore_ascii_case("host") && value.trim() == host)
    });
    let (status, body) = if !valid_host || request.len() >= 4096 {
        ("400 Bad Request", "Invalid request")
    } else if text.lines().next() == Some("GET /harness/preview-relay.html HTTP/1.1") {
        ("200 OK", RELAY)
    } else {
        ("404 Not Found", "Not found")
    };
    write!(stream, "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nContent-Security-Policy: {CSP}\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}", body.len())?;
    stream.flush()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn relay_is_loopback_only_read_only_and_stops() {
        let host = PreviewHost::start().unwrap();
        let address = host.origin.strip_prefix("http://").unwrap().to_owned();
        let request = |route: &str, authority: &str| {
            let mut stream = TcpStream::connect(&address).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            // Exercise an accepted connection before its headers arrive.
            thread::sleep(Duration::from_millis(30));
            write!(stream, "GET {route} HTTP/1.1\r\nHost: {authority}\r\n\r\n").unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).unwrap();
            response
        };
        let ok = request("/harness/preview-relay.html", &address);
        assert!(ok.starts_with("HTTP/1.1 200"));
        assert!(ok.contains("sandbox"));
        assert!(ok.contains("Content-Security-Policy: default-src 'none'"));
        assert!(request("/models.json", &address).starts_with("HTTP/1.1 404"));
        assert!(
            request("/harness/preview-relay.html", "attacker.example").starts_with("HTTP/1.1 400")
        );
        drop(host);
        assert!(TcpStream::connect(address).is_err());
    }
}
