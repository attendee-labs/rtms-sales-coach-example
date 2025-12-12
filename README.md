# Attendee <> RTMS Example

This shows how to use the Attendee API to implement an AI Sales Coach that uses Zoom RTMS. It will process the meeting transcript in real-time and provide coaching tips within the Zoom client.

## Prerequisites

1. **Ngrok** Since Zoom RTMS needs to send webhooks to your local application, you'll need [ngrok](https://ngrok.com/) to create a secure tunnel to your localhost. Ngrok is free for basic usage. If you are deploying this application on the cloud, then you do not need ngrok.

2. **Node version 22+**: This demo uses Node.js version 22 or higher.

3. **OpenAI API Key**: You need an OpenAI API key to generate the sales coach insights.

## Setup Instructions

### 1. Clone the Repository

```bash
git clone https://github.com/attendee-labs/rtms-sales-coach-example
cd rtms-sales-coach-example
```

### 2. Install dependencies

```bash
npm install
```

### 3. Install and Run Ngrok

1. **Install ngrok**: Download from [ngrok.com](https://ngrok.com/) or install via package manager:
   ```bash
   # On macOS with Homebrew
   brew install ngrok
   
   # On Ubuntu/Debian
   snap install ngrok
   ```

2. **Start ngrok tunnel**: In a separate terminal, run:
   ```bash
   ngrok http 5005
   ```
   
3. **Copy the public URL**: Ngrok will display something like:
   ```
   Forwarding    https://abc123.ngrok.io -> http://localhost:5005
   ```
   Copy the `https://abc123.ngrok.io` URL - you'll need this for webhook configuration.

### 4. Create your Zoom RTMS App


1. Go to the [Zoom Developer Portal](https://marketplace.zoom.us/user/build) and create a new General app.

2. On the sidebar select 'Basic Information'.
3. For the OAuth redirect URLs, you can write https://zoom.us or any other URL. Because we are not using OAuth.

4. On the sidebar select 'Access'.
5. Click 'Add new Event Subscription'.
6. Subscribe to the 'RTMS started' and 'RTMS stopped' events.
7. Set the 'Event notification endpoint URL' to the ngrok URL you copied earlier.
8. Save the changes.

9. On the sidebar select 'Surface'.
10. For home url, enter the url in this format: `https://<YOUR NGROK DOMAIN>/sales_coach?meetingId={meetingUUID}`.
11. For 'Select where to use your app', select 'Meetings'.
12. For 'In-client App Features', select 'Zoom App SDK'. 

13. On the sidebar select 'Scopes'.
14. Add the following scopes:
    - meeting:read:meeting_audio
    - meeting:read:meeting_transcript
    - meeting:read:meeting_chat
    - meeting:read:meeting_video

15. On the sidebar select 'Local test'.
16. Click the 'Add app now' button and authorize the app.

18. Go to your Zoom App Settings at https://zoom.us/profile/setting?tab=zoomapps
19. Enable share realtime meeting content with apps
20. Under "Auto-start apps that access shared realtime meeting content" click the "Choose an app to auto-start" button and select your app.

### 5. Configure Attendee

1. Sign into your Attendee account
2. Navigate to the API Keys section and create a new API key, save this in the .env file as ATTENDEE_API_KEY
3. Navigate to the Settings -> Credentials section and click the button to add Zoom credentials.
4. Enter the Client ID and Client Secret of your Zoom RTMS app.
5. Navigate to the Settings -> Webhooks section and create a new webhook. Have it point to `https://<YOUR NGROK DOMAIN>/attendee-webhook`.
6. Subscribe to the 'transcript.update' and 'bot.state_change' events.
7. Save the webhook.

### 6. Set the .env file for your local application

Set the following environment variables in the .env file:
   - ATTENDEE_API_KEY=`<YOUR ATTENDEE API KEY>`
   - ATTENDEE_BASE_URL=`<YOUR ATTENDEE BASE URL>` (defaults to https://app.attendee.dev)
   - OPENAI_API_KEY=`<YOUR OPENAI API KEY>`
   - ZOOM_WEBHOOK_SECRET_TOKEN=`<YOUR ZOOM WEBHOOK SECRET TOKEN>` (only needed if your Zoom app is in the production mode)

### 7. Run the application

```bash
node index.js
```

### 8. Join a meeting and test the application

1. Join a meeting in Zoom. Your RTMS app should automatically start streaming the meeting transcript to the Zoom client.