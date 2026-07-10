const { Pool } = require('pg');
const autocannon = require('autocannon');

// 設定連線字串，可透過環境變數切換
const connectionString = process.env.DB_CONNECTION || 'postgresql://iotuser:iotpassword@localhost:5432/iotdb';
const pool = new Pool({
    connectionString: connectionString,
    max: 20 // 應用層連線池大小，與 PostgreSQL 的 max_connections 相符
});

// 模擬 IoT 設備上報資料的「慢查詢」
async function insertIoTData() {
    const client = await pool.connect();
    try {
        // 故意使用 pg_sleep(1) 模擬慢查詢或複雜寫入
        await client.query('SELECT pg_sleep(1)');
        await client.query('INSERT INTO iot_data (device_id, value) VALUES ($1, $2)', 
                          ['device_' + Math.floor(Math.random() * 1000), Math.random() * 100]);
        return true;
    } catch (err) {
        console.error('Database error:', err.message);
        return false;
    } finally {
        client.release();
    }
}

// 使用 Autocannon 進行壓測
function runLoadTest() {
    const instance = autocannon({
        url: 'http://localhost:3000/insert', // 假設有一個本地 API 觸發資料庫操作
        connections: 200, // 模擬 200 個併發設備
        duration: 30, // 測試 30 秒
        requests: [
            {
                method: 'POST',
                path: '/insert',
                onResponse: (status, body, context) => {
                    // 這裡可以記錄每個請求的結果
                }
            }
        ]
    }, (err, result) => {
        if (err) console.error(err);
        // 測試結束後，印出結果
        console.log('測試完成。結果：', result);
        // 計算成功率
        const successRate = (result['2xx'] / result.requests.total) * 100;
        console.log(`成功率: ${successRate.toFixed(2)}%`);
        // 記錄吞吐量
        console.log(`吞吐量: ${result.requests.total} 請求/30秒`);
        // 記錄錯誤
        console.log(`錯誤數: ${result.errors}`);
        console.log(`非 2xx 回應: ${result.non2xx}`);
    });
}

// 為了簡化，直接在腳本內呼叫資料庫函式，而非啟動 HTTP 服務
async function runDirectTest() {
    console.log('process.env.DB_CONNECTION')
    console.log(process.env.DB_CONNECTION);
    console.log('開始直接資料庫壓測...');
    let totalSuccess = 0;
    let totalFail = 0;
    const testDurationMs = 30000; // 測試持續 30 秒
    const concurrentDevices = 200; // 模擬 200 個併發設備

    // 單個設備的模擬函式：在測試期間內不斷發送請求
    const simulateDevice = async () => {
        let deviceSuccess = 0;
        let deviceFail = 0;
        const deviceStartTime = Date.now();
        
        while (Date.now() - deviceStartTime < testDurationMs) {
            try {
                await insertIoTData();
                deviceSuccess++;
            } catch (e) {
                deviceFail++;
            }
        }
        return { success: deviceSuccess, fail: deviceFail };
    };

    // 建立 200 個併發設備的 Promise 陣列
    const devicePromises = [];
    for (let i = 0; i < concurrentDevices; i++) {
        devicePromises.push(simulateDevice());
    }

    // 等待所有設備完成測試
    const results = await Promise.all(devicePromises);
    
    // 彙總所有設備的結果
    results.forEach(r => {
        totalSuccess += r.success;
        totalFail += r.fail;
    });

    const duration = testDurationMs / 1000;
    console.log(`測試完成。持續時間: ${duration}秒`);
    console.log(`成功請求數: ${totalSuccess}`);
    console.log(`失敗請求數: ${totalFail}`);
    const totalRequests = totalSuccess + totalFail;
    console.log(`成功率: ${totalRequests > 0 ? ((totalSuccess / totalRequests) * 100).toFixed(2) : 0}%`);
    console.log(`吞吐量: ${(totalSuccess / duration).toFixed(2)} 請求/秒`);
    return { success: totalSuccess, fail: totalFail, duration };
}

// 執行測試
runDirectTest();