import { lazy } from 'react'
import { createBrowserRouter, Outlet } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { RedirectIfAuthed, RequireAuth } from './guards'
import { RouteError } from './RouteError'
import { Providers } from './providers'

// Route-level code splitting: every page is its own chunk.
const LandingPage = lazy(() => import('@/features/landing/LandingPage'))
const LoginPage = lazy(() => import('@/features/auth/LoginPage'))
const OnboardingPage = lazy(() => import('@/features/auth/OnboardingPage'))
const HomePage = lazy(() => import('@/features/home/HomePage'))
const DiscoverPage = lazy(() => import('@/features/discover/DiscoverPage'))
const TurfPage = lazy(() => import('@/features/turf/TurfPage'))
const PlayPage = lazy(() => import('@/features/play/PlayPage'))
const MatchesPage = lazy(() => import('@/features/matches/MatchesPage'))
const LobbyPage = lazy(() => import('@/features/lobby/LobbyPage'))
const JoinByCodePage = lazy(() => import('@/features/lobby/JoinByCodePage'))
const BenchPage = lazy(() => import('@/features/bench/BenchPage'))
const RatePage = lazy(() => import('@/features/ratings/RatePage'))
const MyProfilePage = lazy(() => import('@/features/profile/MyProfilePage'))
const EditProfilePage = lazy(() => import('@/features/profile/EditProfilePage'))
const PlayerPage = lazy(() => import('@/features/profile/PlayerPage'))
const HighlightsPage = lazy(() => import('@/features/highlights/HighlightsPage'))
const RecordingPage = lazy(() => import('@/features/highlights/RecordingPage'))
const WeatherAlertPage = lazy(() => import('@/features/weather/WeatherAlertPage'))
const WalletPage = lazy(() => import('@/features/wallet/WalletPage'))
const NotificationsPage = lazy(() => import('@/features/notifications/NotificationsPage'))
const LeaderboardPage = lazy(() => import('@/features/leaderboard/LeaderboardPage'))
const NotFoundPage = lazy(() => import('@/features/misc/NotFoundPage'))
// Partner (service-provider) portal: owns its own descendant routes under /partner/*
const PartnerApp = lazy(() => import('@/partner/PartnerApp'))

export const router = createBrowserRouter([
  {
    element: (
      <Providers>
        <Outlet />
      </Providers>
    ),
    // Providers itself failed → bare (still themed: index.html applies the theme before first paint)
    errorElement: <RouteError />,
    children: [
      {
        // any page failed (missing chunk after a redeploy, offline, render bug) → friendly screen inside Providers
        errorElement: <RouteError />,
        children: [
          { path: '/', element: <LandingPage /> },
          {
            element: <RedirectIfAuthed />,
            children: [{ path: '/login', element: <LoginPage /> }],
          },
          {
            element: <RequireAuth allowUnonboarded />,
            children: [{ path: '/onboarding', element: <OnboardingPage /> }],
          },
          {
            path: '/app',
            element: <RequireAuth />,
            children: [
              {
                element: <AppShell />,
                // in-app pages fail inside the shell so the nav stays usable
                children: [
                  {
                    errorElement: <RouteError variant="inline" />,
                    children: [
                      { index: true, element: <HomePage /> },
                      { path: 'discover', element: <DiscoverPage /> },
                      { path: 'turfs/:slug', element: <TurfPage /> },
                      { path: 'play', element: <PlayPage /> },
                      { path: 'matches', element: <MatchesPage /> },
                      { path: 'lobby/:lobbyId', element: <LobbyPage /> },
                      { path: 'join/:code', element: <JoinByCodePage /> },
                      { path: 'bench', element: <BenchPage /> },
                      { path: 'rate/:lobbyId', element: <RatePage /> },
                      { path: 'profile', element: <MyProfilePage /> },
                      { path: 'profile/edit', element: <EditProfilePage /> },
                      { path: 'players/:userId', element: <PlayerPage /> },
                      { path: 'highlights', element: <HighlightsPage /> },
                      {
                        path: 'highlights/recordings/:recordingId',
                        element: <RecordingPage />,
                      },
                      {
                        path: 'weather/:alertId',
                        element: <WeatherAlertPage />,
                      },
                      { path: 'wallet', element: <WalletPage /> },
                      { path: 'notifications', element: <NotificationsPage /> },
                      { path: 'leaderboard', element: <LeaderboardPage /> },
                    ],
                  },
                ],
              },
            ],
          },
          { path: '/partner/*', element: <PartnerApp /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])
