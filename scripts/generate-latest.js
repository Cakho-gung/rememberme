import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Đọc phiên bản từ tauri.conf.json
const tauriConfPath = path.join(ROOT_DIR, 'src-tauri', 'tauri.conf.json');
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf-8'));
const tag = process.env.RELEASE_TAG || `v${tauriConf.version}`;

const serveMode = process.argv.includes('--serve');
const notes = serveMode 
    ? "Local test update" 
    : `New version ${tag} is available! Please update to experience the latest features and improvements.`;

// Cấu trúc latest.json
const latestJson = {
    version: tag,
    notes: notes,
    pub_date: new Date().toISOString(),
    platforms: {}
};

// Tìm các file .sig trong thư mục build (của cả Local và GH Actions Artifacts)
const searchDirs = [
    path.join(ROOT_DIR, 'src-tauri', 'target', 'release', 'bundle'), // Local build
    path.join(ROOT_DIR, 'artifacts') // GitHub Actions download artifacts
];

function findSigFiles(dir) {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
            results = results.concat(findSigFiles(fullPath));
        } else if (file.endsWith('.sig')) {
            results.push(fullPath);
        }
    });
    return results;
}

let sigFiles = [];
for (const dir of searchDirs) {
    sigFiles = sigFiles.concat(findSigFiles(dir));
}

if (sigFiles.length === 0) {
    console.warn("⚠️ No .sig files found. Did you run `npm run tauri build` first?");
}

const baseUrl = serveMode 
    ? "http://localhost:8080/updater/" 
    : `https://github.com/Cakho-gung/rememberme/releases/download/${tag}/`;

// Mapping file .sig sang platform của Tauri
// VD: .msi.zip.sig -> windows-x86_64
sigFiles.forEach(sigPath => {
    const signature = fs.readFileSync(sigPath, 'utf-8').trim();
    const fileName = path.basename(sigPath); // vd: app_0.1.9_x64_en-US.msi.zip.sig
    const archiveName = fileName.replace('.sig', ''); // vd: app_0.1.9_x64_en-US.msi.zip
    
    // Tự động detect platform từ tên file
    let platform = "unknown";
    if (fileName.includes('.exe.sig') || fileName.includes('.msi.zip') || fileName.includes('.nsis.zip')) {
        platform = "windows-x86_64";
    } else if (fileName.includes('.app.tar.gz.sig') || fileName.includes('.app.tar.gz')) {
        // macOS support cả x86_64 và aarch64
        platform = "darwin-universal"; 
    } else if (fileName.includes('.AppImage.tar.gz') || fileName.includes('.AppImage.sig')) {
        platform = "linux-x86_64";
    }

    // Gắn vào latestJson
    latestJson.platforms[platform] = {
        signature,
        url: baseUrl + archiveName
    };
    
    // Nếu là macOS universal, copy cho cả 2 nền tảng để dễ nhận
    if (platform === "darwin-universal") {
        latestJson.platforms["darwin-x86_64"] = { signature, url: baseUrl + archiveName };
        latestJson.platforms["darwin-aarch64"] = { signature, url: baseUrl + archiveName };
    }
});

// Ghi file latest.json
const outputDir = path.join(ROOT_DIR, 'updater');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
}
const outputPath = path.join(outputDir, 'latest.json');
fs.writeFileSync(outputPath, JSON.stringify(latestJson, null, 2));

console.log(`✅ Generated latest.json at ${outputPath}`);
console.log(JSON.stringify(latestJson, null, 2));

// Copy các file lưu trữ (.zip, .tar.gz) vào thư mục updater để serve cục bộ
if (serveMode) {
    sigFiles.forEach(sigPath => {
        const archivePath = sigPath.replace('.sig', '');
        if (fs.existsSync(archivePath)) {
            const archiveName = path.basename(archivePath);
            fs.copyFileSync(archivePath, path.join(outputDir, archiveName));
            console.log(`📦 Copied ${archiveName} to updater folder for local serving.`);
        }
    });

    // Mở server
    const server = http.createServer((req, res) => {
        console.log(`[GET] ${req.url}`);
        
        // Bỏ query params
        const reqPath = req.url.split('?')[0];
        const filePath = path.join(ROOT_DIR, reqPath);
        
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            res.writeHead(200, {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': filePath.endsWith('.json') ? 'application/json' : 'application/octet-stream'
            });
            fs.createReadStream(filePath).pipe(res);
        } else {
            res.writeHead(404);
            res.end('File not found');
        }
    });

    server.listen(8080, () => {
        console.log(`\n🚀 Local update server running at http://localhost:8080`);
        console.log(`👉 In tauri.conf.json, set endpoints to: ["http://localhost:8080/updater/latest.json"]`);
        console.log(`Press Ctrl+C to stop.\n`);
    });
}
