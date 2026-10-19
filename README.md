# Toucan Trip – AI Travel Planner (Next.js)

Ứng dụng lập kế hoạch du lịch kiểu chat-first: chú toucan "Travel AI" hỏi về chuyến đi, dựng lịch trình theo ngày, gợi ý vé máy bay / khách sạn / quán ăn. Lịch trình cập nhật realtime khi chat.

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind 4 · Leaflet (OpenStreetMap) · dnd-kit · Gemini (`@google/genai`) · Firebase Auth · Supabase (Postgres + Realtime + Storage).

## Cài đặt Firebase Auth + Supabase

Đăng nhập bằng **Firebase Auth** (email/mật khẩu, Google). Dữ liệu (profile, trip, chat) nằm trong **Supabase Postgres**, ảnh (cover trip, avatar) trong **Supabase Storage**. Supabase nhận thẳng Firebase ID token qua [Third-Party Auth](https://supabase.com/docs/guides/auth/third-party/firebase-auth), RLS dùng `auth.jwt()->>'sub'` (= Firebase uid).

1. **Firebase**: tạo project → *Authentication › Sign-in method*: bật **Email/Password** và **Google**. Thêm domain (localhost, domain Vercel) vào *Authorized domains*. Tạo web app để lấy `NEXT_PUBLIC_FIREBASE_*`, và *Service accounts › Generate new private key* để lấy `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`.
2. **Supabase**: tạo project → *Authentication › Sign In / Providers › Third-Party Auth* → **Add Firebase**, nhập Firebase Project ID.
3. Chạy migration `supabase/migrations/20261019000000_init.sql` (SQL Editor, hoặc `supabase link && supabase db push`). Migration tạo bảng `profiles`, `trips`, `messages` + RLS + grant, bật Realtime, và bucket Storage `media` kèm policy theo thư mục `{uid}/`.
4. Điền `.env.local` (xem `.env.example`) / *Vercel › Settings › Environment Variables*. `GEMINI_API_KEY` vẫn là tuỳ chọn.

Luồng đăng nhập: Firebase sign-in → client gọi `POST /api/auth/sync` với ID token → server (firebase-admin) xác thực token, gắn custom claim `role: "authenticated"` (Supabase cần claim này, thiếu thì bị coi là `anon`) và upsert user vào `public.profiles` → client refresh token rồi mới truy cập Supabase. `/api/chat` cũng yêu cầu ID token.

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
  api/chat/route.ts      Một lượt chat: Gemini nếu có key, không thì engine offline (cần Firebase ID token)
  api/auth/sync/route.ts Gắn claim role cho Supabase + đồng bộ user Firebase → public.profiles
lib/
  types.ts               Trip, ItineraryDay/Item, ChatMessage, Card, UserProfile, ItineraryOp
  itinerary-engine.ts    add/remove/move/edit thuần + ước tính thời gian di chuyển
  tools.ts               ToolExecutor (updateTripInfo, updateItinerary, search*) + dựng card
  engines/gemini.ts      Function calling + tool `reply` → { text, quickReplies }
  engines/mock.ts        Travel AI offline
  search.ts              searchFlights/Hotels/Places (MOCK) + geocode (Open-Meteo, không cần key)
  mock-data.ts           Dữ liệu thành phố cho Travel AI offline
  auth.tsx               AuthProvider (Firebase Auth) + sync sang Supabase
  supabase.ts            Supabase client dùng Firebase ID token (accessToken)
  storage.ts             Upload/xoá ảnh trên Supabase Storage (bucket `media`)
  store/                 SupabaseStore (Postgres + Realtime)
  server/auth.ts         firebase-admin (verify token, custom claim) + Supabase service client
  app-state.tsx          React context: chọn trip, gửi chat, sửa itinerary, upload ảnh
components/              SignIn, Home, Chat, Itinerary (kéo-thả), Map (Leaflet), Profile
supabase/                config.toml, migrations/ (schema, RLS, Realtime, Storage)
```

Những quyết định chính:
- **Itinerary là nguồn sự thật duy nhất.** Server không giữ state: client gửi trip + lịch sử chat, `/api/chat` chạy tool trên bản sao rồi trả trip mới. Client lưu vào store và mọi màn hình cập nhật qua subscription (cache cục bộ + Supabase Realtime cho tab/thiết bị khác).
- **Mỗi lần itinerary đổi, bot post card `itineraryUpdate`**, kể cả khi kéo-thả/xoá ở tab Itinerary. Card được post *trước* câu trả lời, nên chip luôn nằm dưới tin nhắn bot mới nhất.
- **Giá không bao giờ do model tự viết.** Card vé/khách sạn/quán được dựng từ kết quả tool; model kết thúc mỗi lượt bằng tool `reply(text, quickReplies)`.
- **Khác spec:** spec ghi "Gemini qua Firebase AI Logic". Trên web + Vercel, gọi Gemini từ API route với key nằm trong env server vẫn giữ đúng nguyên tắc "không ship key", lại không bắt buộc phải có Firebase mới chạy được. Nếu muốn đúng Firebase AI Logic thì có thể đổi sang `firebase/ai` phía client (cần bật App Check).
- Kéo-thả trong một ngày giữ nguyên các khung giờ: item đổi chỗ sẽ nhận khung giờ theo vị trí mới.
- Ảnh (cover trip, ảnh điểm dừng, avatar): tạm thời lưu trên **Vercel Blob** (store public, `BLOB_READ_WRITE_TOKEN`). Người dùng tải ảnh lên (trình duyệt → Blob trực tiếp, `/api/images/upload` chỉ ký token sau khi xác thực Firebase và giới hạn trong thư mục `{uid}/`) hoặc tạo ảnh bằng Gemini (`/api/images/generate`, model `GEMINI_IMAGE_MODEL`, có preview trước khi dùng, ảnh AI được ghi nhãn). `NEXT_PUBLIC_IMAGE_STORAGE=supabase` để quay lại Supabase Storage.
- Ảnh địa điểm lấy từ Wikipedia/Wikimedia Commons (không cần key): `/api/chat` tìm bài viết gần toạ độ mỗi điểm dừng có tên khớp, lưu `imageUrl` + `imageCredit` (tác giả, giấy phép — bắt buộc hiển thị). Điểm chung chung ("Local Breakfast Café") không có ảnh → gradient. Đặt `WIKIMEDIA_CONTACT` (email hoặc URL) để được 200 request/phút thay vì 10.
- Bản đồ dùng tile CARTO Voyager nếu có `NEXT_PUBLIC_CARTO_API_KEY` (key miễn phí tại carto.com/basemaps/apikey — từ 09/2026 CARTO bắt buộc key, thiếu key sẽ ra ảnh "API KEY REQUIRED"); không có key thì dùng tile OpenStreetMap. Đường nối giữa các điểm là đường thẳng nét đứt; thời gian di chuyển là ước tính theo khoảng cách.

## Còn để sau (đúng phạm vi MVP)

- API thật cho vé máy bay / khách sạn / booking (hiện là mock, card có nhãn **SAMPLE**) và Google Places cho `searchPlaces`.
- Đăng nhập Apple (thiết kế có nút, cần Apple Developer + bật provider trong Firebase).
- Bucket `media` là public (đọc được qua URL, đường dẫn chứa id ngẫu nhiên); chỉ chủ sở hữu được ghi/xoá.
