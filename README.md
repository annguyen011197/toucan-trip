# Toucan Trip – AI Travel Planner (Next.js)

Ứng dụng lập kế hoạch du lịch kiểu chat-first: chú toucan "Travel AI" hỏi về chuyến đi, dựng lịch trình theo ngày, gợi ý vé máy bay / khách sạn / quán ăn. Lịch trình cập nhật realtime khi chat.

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind 4 · Leaflet (OpenStreetMap) · dnd-kit · Gemini (`@google/genai`) · Firebase (tuỳ chọn).

## Deploy lên Vercel

1. Push thư mục này lên GitHub → **Vercel › Add New Project** → chọn repo. Không cần chỉnh gì (framework tự nhận là Next.js).
2. Deploy. Không có biến môi trường nào, app vẫn chạy được:
   - **Travel AI offline**: engine theo luật, đi đúng chat flow trong spec.
   - Dữ liệu lưu trong trình duyệt (localStorage), có sẵn 2 trip mẫu.
3. Bật Gemini: thêm `GEMINI_API_KEY` (lấy ở Google AI Studio) trong *Settings › Environment Variables*, rồi Redeploy. Key chỉ dùng ở server (`/api/chat`), không bao giờ gửi xuống trình duyệt.
4. (Tuỳ chọn) Dùng Firestore thay localStorage: thêm `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`. Trong Firebase console: bật **Anonymous Auth**, tạo Firestore, deploy `firebase/firestore.rules` + `firestore.indexes.json` (`firebase deploy --only firestore`), và thêm domain Vercel vào *Authentication › Authorized domains*.

Nhãn ở góc trên màn Home cho biết đang chạy chế độ nào (`OFFLINE AI · THIS DEVICE` / `GEMINI · FIRESTORE`).

## Chạy local

```bash
npm install
cp .env.example .env.local   # tuỳ chọn
npm run dev                  # http://localhost:3000
npm test                     # engine + toàn bộ chat flow offline
```

Câu lệnh Travel AI offline hiểu được (ngoài các chip):
`add Nishiki Market at 9am on Day 2` · `add a food tour on Day 3` · `remove Nijo Castle` · `move Gion to Day 3` · `make Day 1 more relaxed` · `find flights` · `find hotels` · `Looks good, confirm!`

## Kiến trúc

```
app/
  page.tsx               App shell (mobile-first, 5 tab)
  api/chat/route.ts      Một lượt chat: Gemini nếu có key, không thì engine offline
lib/
  types.ts               Trip, ItineraryDay/Item, ChatMessage, Card, UserProfile, ItineraryOp
  itinerary-engine.ts    add/remove/move/edit thuần + ước tính thời gian di chuyển
  tools.ts               ToolExecutor (updateTripInfo, updateItinerary, search*) + dựng card
  engines/gemini.ts      Function calling + tool `reply` → { text, quickReplies }
  engines/mock.ts        Travel AI offline
  search.ts              searchFlights/Hotels/Places (MOCK) + geocode (Open-Meteo, không cần key)
  mock-data.ts           6 thành phố mẫu, hand-picked, seed trips
  store/                 LocalStore (localStorage + đồng bộ giữa các tab) | FirebaseStore (Firestore)
  app-state.tsx          React context: chọn trip, gửi chat, sửa itinerary
components/              Home, Chat, Itinerary (kéo-thả), Map (Leaflet), Profile
firebase/                firestore.rules, firestore.indexes.json
```

Những quyết định chính:
- **Itinerary là nguồn sự thật duy nhất.** Server không giữ state: client gửi trip + lịch sử chat, `/api/chat` chạy tool trên bản sao rồi trả trip mới. Client lưu vào store và mọi màn hình cập nhật qua subscription (Firestore `onSnapshot` hoặc listener nội bộ).
- **Mỗi lần itinerary đổi, bot post card `itineraryUpdate`**, kể cả khi kéo-thả/xoá ở tab Itinerary. Card được post *trước* câu trả lời, nên chip luôn nằm dưới tin nhắn bot mới nhất.
- **Giá không bao giờ do model tự viết.** Card vé/khách sạn/quán được dựng từ kết quả tool; model kết thúc mỗi lượt bằng tool `reply(text, quickReplies)`.
- **Khác spec:** spec ghi "Gemini qua Firebase AI Logic". Trên web + Vercel, gọi Gemini từ API route với key nằm trong env server vẫn giữ đúng nguyên tắc "không ship key", lại không bắt buộc phải có Firebase mới chạy được. Nếu muốn đúng Firebase AI Logic thì có thể đổi sang `firebase/ai` phía client (cần bật App Check).
- Kéo-thả trong một ngày giữ nguyên các khung giờ: item đổi chỗ sẽ nhận khung giờ theo vị trí mới.
- Bản đồ dùng tile CARTO/OSM (không cần key). Đường nối giữa các điểm là đường thẳng nét đứt; thời gian di chuyển là ước tính theo khoảng cách.

## Còn để sau (đúng phạm vi MVP)

- API thật cho vé máy bay / khách sạn / booking (hiện là mock, card có nhãn **SAMPLE**) và Google Places cho `searchPlaces`.
- Màn Sign in (đã có thiết kế Stitch). Hiện Firebase dùng Anonymous Auth.
- Ảnh đang dùng URL từ bản Stitch (Google host, có thể hết hạn); khi lỗi sẽ tự hiện gradient.
