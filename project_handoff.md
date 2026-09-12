# Handoff: Sports Turf Booking & Matchmaking Platform

## Goal
Build an MVP for a centralized web application that allows users in Kochi, Kerala to discover, book, and find teammates for sports turfs (football, badminton, cricket nets, etc.) in real-time.

## Current State
- Requirements gathered and validated against existing competitors (Playo, Playspots).
- Tech stack selected and architecture designed.
- Database schema established (PostgreSQL).
- Real-time interaction logic (matchmaking and booking concurrency) documented.
- No code written yet. We are transitioning to the implementation phase.

## Decisions Made (Do not re-litigate)
- **Tech Stack:** React (Frontend), FastAPI (Backend), PostgreSQL (Database), Redis (Pub/Sub for WebSockets).
- **Mobile Strategy:** Start as a responsive React web app. The backend should be completely detached to support future iOS/Android apps seamlessly.
- **Concurrency Strategy:** Use PostgreSQL pessimistic row locking (`SELECT ... FOR UPDATE NOWAIT`) on a dedicated `slots` table to prevent double bookings.
- **Matchmaking Strategy:** Implement dynamic waiting lobbies via FastAPI WebSockets. Use Redis Pub/Sub as the message backplane to broadcast lobby state changes across multiple backend server instances.
- **Payment Strategy:** Razorpay integration to handle split payments (e.g., dividing the turf fee among all matched lobby members) with a Time-to-Live (TTL) timer on the slot lock.

## Key Features for MVP
1. **Turf Discovery:** Location-based interactive map/list to browse local sports venues.
2. **Real-Time Booking:** Calendars showing live availability with immediate slot locking during checkout.
3. **The "Live Bench" & Matchmaking:** Solo players can join queues for specific sports (e.g., 5v5 football) and get instantly notified when the lobby fills up.
4. **Split Payments:** Webhook-based integration ensuring a slot is confirmed only when all lobby participants pay their fraction.

## Database Schema (PostgreSQL)
- `users`: id, name, phone_number, created_at
- `turfs`: id, name, sport_type, lat/long, price_per_hour
- `slots`: id, turf_id, start_time, end_time, status (available/pending/booked)
- `bookings`: id, slot_id, booked_by, total_amount, payment_status
- `lobbies`: id, slot_id, host_user_id, required_players, status
- `lobby_members`: lobby_id, user_id, joined_at, payment_status

## Architecture & Data Flow
1. **Booking Flow:** React Client -> FastAPI -> PostgreSQL (`FOR UPDATE NOWAIT` lock) -> Razorpay link generation -> Razorpay Webhook -> Unlock or Confirm.
2. **Matchmaking Flow:** React Client -> FastAPI WebSocket Upgrade -> Postgres Registration -> Publish to Redis Channel -> Redis Fan-Out Broadcast -> All Connected Clients Update UI.

## Next Steps
1. **Initialize Repositories:** Set up the React frontend (Vite or Next.js) and the FastAPI backend.
2. **Database Setup:** Execute the PostgreSQL schema and populate 3-5 mock turfs in Kochi to test the API.
3. **API Foundation:** Build the FastAPI endpoints for turf fetching and the critical row-locking booking mechanism.
4. **WebSocket Foundation:** Set up the Redis instance and basic WebSocket connection logic for a test lobby.
