# 7s Fantasy

ลีก Fantasy ของก๊วนบอล 7 คน — หน้าเว็บ `index.html` + API ใน `api/` เก็บข้อมูลใน Upstash Redis

## Deploy บน Vercel
1. อัปโหลดโฟลเดอร์นี้ขึ้น GitHub แล้ว Import เป็นโปรเจกต์ใน Vercel (Framework Preset: Other)
2. Storage > Create Database > Upstash for Redis (Free) > Connect กับโปรเจกต์นี้
3. Deployments > Redeploy

## Environment Variables (ไม่บังคับ)
- `ADMIN_PIN` รหัสผู้ดูแล ใช้รีเซ็ตรหัสของนักเตะที่ลืมรหัส
- `GROUP_PIN` รหัสก๊วน ถ้าตั้งไว้ ทุกคนต้องใส่ก่อนแก้ข้อมูล
- Web Analytics: เปิดที่แท็บ Analytics ในโปรเจกต์ (สคริปต์ติดตั้งใน index.html แล้ว)
