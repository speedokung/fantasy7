# 7s Fantasy

ลีก Fantasy ของก๊วนบอล 7 คน — หน้าเว็บ `index.html` + API `api/data.js` เก็บข้อมูลใน Upstash Redis

## Deploy บน Vercel
1. อัปโหลดโฟลเดอร์นี้ขึ้น GitHub แล้ว Import เป็นโปรเจกต์ใน Vercel (Framework Preset: Other)
2. ในโปรเจกต์ Vercel > Storage > Create Database > Upstash for Redis (Free) > Connect กับโปรเจกต์นี้
3. Deployments > Redeploy

ตัวเลือก: ตั้ง Environment Variable `GROUP_PIN` เพื่อบังคับให้ใส่รหัสก่อนแก้ข้อมูล
