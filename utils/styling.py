"""
utils/styling.py
Shared CSS theme and sidebar helpers for all PACE pages.
"""
import streamlit as st

# ── Color tokens ─────────────────────────────────────────────────────────────
NAVY_900  = "#0F2B4A"
NAVY_700  = "#1A3F6F"
NAVY_500  = "#2563A8"
NAVY_100  = "#DBEAFE"

RISK_LOW_BG   = "#D1FAE5"
RISK_LOW_FG   = "#059669"
RISK_MED_BG   = "#FEF3C7"
RISK_MED_FG   = "#D97706"
RISK_HIGH_BG  = "#FEE2E2"
RISK_HIGH_FG  = "#DC2626"

# ── Shared CSS ────────────────────────────────────────────────────────────────
PACE_CSS = f"""
<style>
/* ── Global ───────────────────────────────────────── */
.stApp {{
    background-color: #F9FAFB;
    font-family: 'Inter', 'Segoe UI', sans-serif;
}}

/* ── Sidebar ──────────────────────────────────────── */
[data-testid="stSidebar"] {{
    background-color: {NAVY_900} !important;
}}
[data-testid="stSidebar"] p,
[data-testid="stSidebar"] span,
[data-testid="stSidebar"] label,
[data-testid="stSidebar"] .stMarkdown {{
    color: #CBD5E1 !important;
}}
[data-testid="stSidebar"] h1,
[data-testid="stSidebar"] h2,
[data-testid="stSidebar"] h3 {{
    color: #FFFFFF !important;
}}
/* Nav links */
[data-testid="stSidebarNav"] a span {{
    color: #94A3B8 !important;
    font-size: 14px;
}}
[data-testid="stSidebarNav"] a:hover span {{
    color: #FFFFFF !important;
}}
[data-testid="stSidebarNav"] a[aria-current="page"] span {{
    color: #FFFFFF !important;
    font-weight: 600;
}}
[data-testid="stSidebarNav"] a[aria-current="page"] {{
    background-color: rgba(255,255,255,0.12) !important;
    border-left: 3px solid #FFFFFF;
    border-radius: 0 6px 6px 0;
}}

/* ── Metric Cards ─────────────────────────────────── */
[data-testid="stMetric"] {{
    background-color: #FFFFFF;
    border: 1px solid #E5E7EB;
    border-radius: 12px;
    padding: 20px 24px !important;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}}
[data-testid="stMetricLabel"] > div {{
    font-size: 11px !important;
    font-weight: 600 !important;
    letter-spacing: 0.6px;
    color: #6B7280 !important;
    text-transform: uppercase;
}}
[data-testid="stMetricValue"] > div {{
    font-size: 26px !important;
    font-weight: 700 !important;
    color: #111827 !important;
}}
[data-testid="stMetricDelta"] {{
    font-size: 12px !important;
}}

/* ── Primary Buttons ─────────────────────────────── */
.stButton > button[kind="primary"] {{
    background-color: {NAVY_900} !important;
    color: #FFFFFF !important;
    border: none !important;
    border-radius: 8px !important;
    font-weight: 600 !important;
    letter-spacing: 0.3px;
}}
.stButton > button[kind="primary"]:hover {{
    background-color: {NAVY_700} !important;
    border: none !important;
}}

/* ── Headings ────────────────────────────────────── */
h1 {{ color: #111827 !important; font-weight: 700 !important; }}
h2 {{ color: #1F2937 !important; font-weight: 600 !important; }}
h3 {{ color: #374151 !important; font-weight: 600 !important; }}

/* ── Dataframe ───────────────────────────────────── */
[data-testid="stDataFrame"] {{
    border: 1px solid #E5E7EB !important;
    border-radius: 8px;
    overflow: hidden;
}}

/* ── Tabs ────────────────────────────────────────── */
.stTabs [data-baseweb="tab-list"] {{
    gap: 4px;
    border-bottom: 2px solid #E5E7EB;
}}
.stTabs [data-baseweb="tab"] {{
    border-radius: 6px 6px 0 0;
    font-weight: 500;
    color: #6B7280;
}}
.stTabs [aria-selected="true"] {{
    color: {NAVY_900} !important;
    border-bottom: 2px solid {NAVY_900} !important;
}}

/* ── File uploader ───────────────────────────────── */
[data-testid="stFileUploader"] {{
    border: 2px dashed #D1D5DB;
    border-radius: 12px;
    background-color: #F9FAFB;
    padding: 16px;
}}
[data-testid="stFileUploader"]:hover {{
    border-color: {NAVY_500};
    background-color: {NAVY_100};
}}

/* ── Alerts ──────────────────────────────────────── */
[data-testid="stAlert"] {{
    border-radius: 8px !important;
}}
</style>
"""


def inject_css() -> None:
    """Inject PACE theme CSS into the current page."""
    st.markdown(PACE_CSS, unsafe_allow_html=True)


def sidebar_header(username: str) -> None:
    """Render the PACE branding + user block in the sidebar."""
    st.sidebar.markdown(
        f"""
        <div style="padding:16px 0 12px;">
            <div style="font-size:22px; font-weight:700; color:#FFFFFF; letter-spacing:1px;">
                📦 PACE
            </div>
            <div style="font-size:11px; color:#64748B; margin-top:2px; letter-spacing:0.4px;">
                PREDICTIVE ACCESSORIAL COST ENGINE
            </div>
        </div>
        <div style="border-top:1px solid rgba(255,255,255,0.12);
                    padding:12px 0;
                    margin-bottom:4px;">
            <div style="font-size:11px; color:#64748B; text-transform:uppercase;
                        letter-spacing:0.5px;">Signed in as</div>
            <div style="font-size:14px; font-weight:600; color:#FFFFFF; margin-top:3px;">
                👤 {username}
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def risk_badge_html(tier: str) -> str:
    """Return an HTML badge string for a risk tier label."""
    colors = {
        "High":   (RISK_HIGH_BG,  RISK_HIGH_FG),
        "Medium": (RISK_MED_BG,   RISK_MED_FG),
        "Low":    (RISK_LOW_BG,   RISK_LOW_FG),
    }
    bg, fg = colors.get(tier, ("#F3F4F6", "#6B7280"))
    return (
        f'<span style="background:{bg}; color:{fg}; padding:3px 10px; '
        f'border-radius:4px; font-size:11px; font-weight:600;">{tier}</span>'
    )
