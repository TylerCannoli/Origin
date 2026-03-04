"""
utils/styling.py
Shared CSS theme and fixed top navigation bar for all PACE pages.
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

# ── Navigation pages ──────────────────────────────────────────────────────────
_NAV_PAGES = [
    ("🏠 Home",        "/Home"),
    ("📊 Dashboard",   "/Dashboard"),
    ("📁 Upload",      "/Upload"),
    ("🚚 Shipments",   "/Shipments"),
    ("💰 Cost Est.",   "/Cost_Estimate"),
    ("🗺️ Routes",      "/Route_Analysis"),
    ("🚛 Carriers",    "/Carrier_Comparison"),
    ("📋 Accessorial", "/Accessorial_Tracker"),
]

# ── Base page CSS (injected on every page) ────────────────────────────────────
_BASE_CSS = f"""
<style>
/* ── Global ───────────────────────────────────────── */
.stApp {{
    background-color: #F9FAFB;
    font-family: 'Inter', 'Segoe UI', sans-serif;
}}

/* ── Hide Streamlit chrome and sidebar ────────────── */
#MainMenu, header, footer {{ visibility: hidden; }}
[data-testid="stSidebar"],
[data-testid="collapsedControl"],
section[data-testid="stSidebarNav"] {{
    display: none !important;
}}

/* ── Push content below fixed nav ─────────────────── */
.block-container {{
    padding-top: 4.5rem !important;
    padding-left: 2.5rem !important;
    padding-right: 2.5rem !important;
    max-width: 1400px !important;
}}

/* ── Fixed top nav bar ────────────────────────────── */
.pace-nav {{
    position: fixed;
    top: 0; left: 0; right: 0;
    z-index: 99999;
    background: {NAVY_900};
    height: 54px;
    display: flex;
    align-items: center;
    padding: 0 20px;
    gap: 2px;
    border-bottom: 2px solid {NAVY_700};
    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    font-family: 'Inter', 'Segoe UI', sans-serif;
}}
.pace-nav .nav-logo {{
    font-size: 16px;
    font-weight: 700;
    color: #FFFFFF;
    letter-spacing: 1.5px;
    margin-right: 20px;
    text-decoration: none;
    white-space: nowrap;
}}
.pace-nav .nav-link {{
    color: rgba(255,255,255,0.62);
    font-size: 13px;
    font-weight: 500;
    text-decoration: none;
    padding: 5px 10px;
    border-radius: 5px;
    white-space: nowrap;
    transition: background 0.15s, color 0.15s;
}}
.pace-nav .nav-link:hover {{
    color: #FFFFFF;
    background: rgba(255,255,255,0.12);
}}
.pace-nav .nav-divider {{
    width: 1px;
    height: 20px;
    background: rgba(255,255,255,0.15);
    margin: 0 8px;
}}
.pace-nav .nav-spacer {{ flex: 1; }}
.pace-nav .nav-user {{
    color: rgba(255,255,255,0.72);
    font-size: 12px;
    font-weight: 500;
    margin-right: 12px;
    white-space: nowrap;
}}
.pace-nav .nav-signout {{
    color: rgba(255,255,255,0.62);
    font-size: 12px;
    font-weight: 500;
    text-decoration: none;
    padding: 4px 10px;
    border: 1px solid rgba(255,255,255,0.22);
    border-radius: 5px;
    white-space: nowrap;
    transition: all 0.15s;
}}
.pace-nav .nav-signout:hover {{
    color: #FFFFFF;
    border-color: rgba(255,255,255,0.5);
    background: rgba(255,255,255,0.1);
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

/* ── Primary Buttons ─────────────────────────────── */
.stButton > button[kind="primary"] {{
    background-color: {NAVY_900} !important;
    color: #FFFFFF !important;
    border: none !important;
    border-radius: 8px !important;
    font-weight: 600 !important;
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
[data-testid="stAlert"] {{ border-radius: 8px !important; }}
</style>
"""


def inject_css() -> None:
    """Inject PACE base CSS. Call at the top of every page."""
    st.markdown(_BASE_CSS, unsafe_allow_html=True)


def top_nav(username: str) -> None:
    """
    Render the fixed horizontal top navigation bar.
    Handles logout via ?action=logout query param.
    Call this at the top of every authenticated page, after inject_css().
    """
    # Handle logout triggered by clicking "Sign Out" in the nav bar
    if st.query_params.get("action") == "logout":
        st.query_params.clear()
        from auth_utils import logout
        logout()

    nav_links = "".join(
        f'<a class="nav-link" href="{url}">{label}</a>'
        for label, url in _NAV_PAGES
    )

    st.markdown(
        f"""
        <nav class="pace-nav">
            <a class="nav-logo" href="/Home">📦 PACE</a>
            <div class="nav-divider"></div>
            {nav_links}
            <div class="nav-spacer"></div>
            <span class="nav-user">👤 {username}</span>
            <a class="nav-signout" href="?action=logout">Sign Out</a>
        </nav>
        """,
        unsafe_allow_html=True,
    )


def risk_badge_html(tier: str) -> str:
    """Return an HTML badge string for a risk tier label."""
    colors = {
        "High":   (RISK_HIGH_BG, RISK_HIGH_FG),
        "Medium": (RISK_MED_BG,  RISK_MED_FG),
        "Low":    (RISK_LOW_BG,  RISK_LOW_FG),
    }
    bg, fg = colors.get(tier, ("#F3F4F6", "#6B7280"))
    return (
        f'<span style="background:{bg}; color:{fg}; padding:3px 10px; '
        f'border-radius:4px; font-size:11px; font-weight:600;">{tier}</span>'
    )


# Keep for backwards compatibility — now a no-op
def sidebar_header(username: str) -> None:
    pass
