# دليل النشر السريع

## 1 – Google Sheets
أنشئ جدولاً جديداً، غيّر اسم الورقة إلى: `DailyMetrics`

## 2 – Apps Script
Extensions → Apps Script → احذف الكود الافتراضي → الصق Code.gs → Save

**شغّل setupKeys() مرة واحدة:**
اختر الدالة `setupKeys` من القائمة المنسدلة → Run
(ستُخزَّن الرموز: SUPERVISOR_KEY=RW-2026 و QUALITY_KEY=QA-2026)

## 3 – نشر Web App
Deploy → New Deployment
- Type: Web App
- Execute as: Me
- Who has access: **Anyone**
- اضغط Deploy → انسخ الرابط

## 4 – وضع API_URL
في كلا الملفين ابحث عن:
  `YOUR_APPS_SCRIPT_WEB_APP_URL_HERE`
واستبدله بالرابط المنسوخ.

## 5 – GitHub Pages
Repository → رفع الملفين → Settings → Pages → main / root → Save
الروابط:
  https://USERNAME.github.io/REPO/supervisor.html
  https://USERNAME.github.io/REPO/quality.html

## رموز الدخول الافتراضية
| الصفحة | الرمز |
|---|---|
| supervisor.html | RW-2026 |
| quality.html | QA-2026 |

لتغيير الرموز: عدّل setupKeys() في Code.gs ثم أعد تشغيلها.

## ملاحظة CORS
إذا ظهر خطأ CORS: أعد النشر من Deploy → Manage → Edit → New version
