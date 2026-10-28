# HR Flow — Enterprise Operations Portal & Employee Case System

A full-stack, AI-powered HR Operations and Case Management Platform. Built with Python (Flask, Gunicorn), SQLite, and modern responsive JavaScript/CSS frontend.

Ready for 1-click cloud deployment on **Render.com** (or Railway / Fly.io / Docker).

---

## 📂 Repository Contents

```
HR WORK GITHUB Upload/
├── backend/                  # Flask REST API, AI engines, workflow services, auth
│   ├── api/                  # API endpoints (cases, emails, audit, integrations)
│   ├── classification/       # AI intent classifiers and ML models
│   ├── database/             # SQLite connection, schema, init_db.py
│   ├── services/             # Business logic (cases, SLA, email sync, notifications)
│   ├── config.py             # Central configuration
│   └── server.py             # Flask application entry point
├── frontend/                 # Complete frontend portal
│   ├── inbox.html            # Admin Operations Portal & Case Workspace
│   ├── login.html            # Unified Login Portal (Admin, Agent, Employee)
│   ├── track.html            # Public Employee Case Tracker
│   ├── feedback.html         # Public Employee CSAT Star Rating & Review
│   ├── agent.html            # Specialist / HR Agent Workspace
│   ├── css/                  # Modern responsive design system
│   └── js/                   # Vanilla JS modules & reactive components
├── data/
│   └── hrflow.db             # Pre-seeded SQLite database with Admin & Teams
├── WorkFlow/                 # Configured department workflows & SLA policies
├── Dockerfile                # Production container specification
├── Procfile                  # Gunicorn web process definition
├── render.yaml               # Render 1-click Blueprint configuration
├── requirements.txt          # Python dependencies
└── .env.example              # Sample environment variables
```

---

## 🚀 Part 1: How to Upload to GitHub

You can upload this folder to GitHub using any of the 3 methods below.

### Method A: Upload Directly via GitHub Website (Easiest — No Tools Required)

1. Go to [github.com](https://github.com) and log in.
2. Click the **`+`** icon at the top right → **New repository**.
3. Name it `hr-flow-portal`, set it to **Public** (or **Private**), and click **Create repository**.
4. On the next screen, click the link: **"uploading an existing file"**.
5. Drag and drop all the contents of the `HR WORK GITHUB Upload` folder into the browser window.
6. Scroll down, type `Initial commit`, and click **Commit changes**.

---

### Method B: Upload via GitHub Desktop (Visual App)

1. Open **GitHub Desktop** on your computer.
2. Click **File** → **Add Local Repository...**
3. Choose the `HR WORK GITHUB Upload` folder.
4. If prompted to initialize Git, click **Create Repository**.
5. Click **Publish repository** to push it to your GitHub account.

---

### Method C: Upload via Terminal (Git CLI)

Run these commands inside the `HR WORK GITHUB Upload` folder:

```bash
cd "HR WORK GITHUB Upload"
git init
git add .
git commit -m "feat: initial release of HR Flow Portal for Render"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/hr-flow-portal.git
git push -u origin main
```

---

## 🌐 Part 2: Deploy to Render (Render.com)

### Option 1: Automatic Blueprint Deployment (Recommended)

Render will automatically read `render.yaml` from this repository:

1. Log in to [dashboard.render.com](https://dashboard.render.com).
2. Click **New +** → **Blueprint**.
3. Connect your GitHub account and select your `hr-flow-portal` repository.
4. Click **Apply**. Render will automatically:
   - Install Python 3.11 dependencies (`requirements.txt`).
   - Run database migrations (`python -m backend.database.init_db`).
   - Start the high-performance Gunicorn web server.
5. In ~2 minutes, your website will be live at:
   `https://hr-flow-operations-portal.onrender.com`

---

### Option 2: Manual Web Service Deployment

If you prefer setting up the web service manually:

1. In Render Dashboard, click **New +** → **Web Service**.
2. Connect your GitHub repository.
3. Configure the following fields:
   - **Name**: `hr-flow-operations-portal` (or any name you choose)
   - **Language**: `Python`
   - **Branch**: `main`
   - **Region**: Closest to you (e.g., Oregon, Frankfurt, Singapore)
   - **Build Command**:
     ```bash
     pip install -r requirements.txt && python -m backend.database.init_db
     ```
   - **Start Command**:
     ```bash
     gunicorn backend.server:app --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 120
     ```
4. Click **Create Web Service**.

---

## 🔑 Default Login Credentials

Once your Render site is live, visit `https://your-app.onrender.com/login.html`:

| Role | Email | Password | Access |
|---|---|---|---|
| **Admin** | `nunux365@gmail.com` | `admin` (or OTP / 1-click login) | Full Admin Control, Cases, Audit, Settings |
| **HR Agent** | `vaibhavx002@zohomail.in` | `agent` (or OTP / 1-click login) | Specialist Case Workspace & Tasks |
| **Public Employee** | Any employee email | No password needed | Self-service tracker at `/track.html` |

---

## ⚙️ Environment Variables (Optional)

You can set these in Render Dashboard → **Environment**:

| Variable | Recommended Value | Purpose |
|---|---|---|
| `FLASK_ENV` | `production` | Production mode |
| `FLASK_DEBUG` | `false` | Disables debug stack traces |
| `SECRET_KEY` | *(Random 32-character string)* | Session signing key |
| `DATABASE_PATH` | `data/hrflow.db` | Path to SQLite database |

---

## 🩺 Verification & Health Check

After deployment finishes, test that your backend and AI models are running:

- **Health Check**: `https://your-app.onrender.com/api/health`
  - Returns `{"status": "ok", "app": "HR Flow", "models_ready": true}`
- **Admin Portal**: `https://your-app.onrender.com/` or `https://your-app.onrender.com/inbox.html`
- **Employee Tracking**: `https://your-app.onrender.com/track.html`

