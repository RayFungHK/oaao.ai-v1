.oaao-slide-canvas.oaao-layout-{{layout}} {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 1280px;
  height: 720px;
  min-height: 720px;
  overflow: hidden;
  padding: 0;
  font-family: {{font_stack}};
  background: {{bg}};
  color: {{fg}};
}
.oaao-slide-topbar {
  flex: 0 0 auto;
  height: 6px;
  background: linear-gradient(90deg, {{bar}}, {{accent}});
}
.oaao-slide-header {
  flex: 0 0 auto;
  padding: 1.35rem 3rem 0.75rem;
}
.oaao-slide-header h1 {
  margin: 0;
  font-size: 1.85rem;
  line-height: 1.2;
  color: {{accent}};
  font-weight: 700;
}
.oaao-slide-body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 0 3rem 2.25rem;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.oaao-slide-body-fill {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: stretch;
}
.oaao-slide-body ul {
  margin: 0;
  padding-left: 1.4rem;
  line-height: 1.55;
  font-size: {{body_size}}rem;
}
.oaao-slide-body li { margin: 0.35rem 0; }
.oaao-slide-body p {
  margin: 0 0 0.75rem;
  font-size: 1.05rem;
  line-height: 1.5;
  color: {{muted}};
  max-width: 52rem;
}
.oaao-two-col {
  display: grid;
  grid-template-columns: 1fr 360px;
  gap: 2rem;
  flex: 1 1 auto;
  min-height: 320px;
  align-items: stretch;
}
.oaao-two-col > .oaao-col-main {
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.oaao-callout {
  padding: 1.5rem 1.5rem;
  border-radius: 14px;
  background: {{card}};
  border: 1px solid color-mix(in srgb, {{accent}} 28%, transparent);
  font-size: 1.02rem;
  line-height: 1.5;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: center;
}
.oaao-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: 1fr;
  gap: 1.25rem;
  flex: 1 1 auto;
  min-height: 340px;
  align-items: stretch;
}
.oaao-card {
  padding: 1.35rem 1.35rem;
  border-radius: 14px;
  background: {{card}};
  border: 1px solid color-mix(in srgb, {{fg}} 10%, transparent);
  min-height: 100%;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 24px color-mix(in srgb, {{fg}} 6%, transparent);
}
.oaao-card h3 {
  margin: 0 0 0.5rem;
  font-size: 1.05rem;
  color: {{accent}};
}
.oaao-card ul {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.92rem;
}
.oaao-hero {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  flex: 1 1 auto;
  min-height: 720px;
  padding: 3.5rem 4rem 4rem;
  box-sizing: border-box;
}
.oaao-hero h1 {
  margin: 0 0 1rem;
  font-size: 2.75rem;
  line-height: 1.15;
  color: {{accent}};
  max-width: 46rem;
}
.oaao-hero .deck {
  font-size: 1.15rem;
  color: {{muted}};
  max-width: 40rem;
  line-height: 1.5;
}
.oaao-summary-box {
  flex: 1 1 auto;
  min-height: 280px;
  padding: 2rem 2rem;
  border-radius: 14px;
  background: {{card}};
  border-left: 6px solid {{accent}};
  display: flex;
  flex-direction: column;
  justify-content: center;
  box-sizing: border-box;
}
.oaao-card:nth-child(1) { border-top: 4px solid {{accent}}; }
.oaao-card:nth-child(2) { border-top: 4px solid color-mix(in srgb, {{accent}} 55%, {{fg}}); }
.oaao-card:nth-child(3) { border-top: 4px solid color-mix(in srgb, {{muted}} 70%, {{accent}}); }
.oaao-faq-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2rem;
  flex: 1 1 auto;
  min-height: 340px;
  align-items: stretch;
}
.oaao-faq-q {
  padding: 1.5rem;
  border-radius: 14px;
  background: color-mix(in srgb, {{card}} 90%, {{bg}});
  border: 1px solid color-mix(in srgb, {{accent}} 22%, transparent);
}
.oaao-faq-q h3 { margin: 0 0 0.75rem; font-size: 1rem; color: {{accent}}; text-transform: uppercase; letter-spacing: 0.06em; }
.oaao-faq-a {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  justify-content: center;
}
.oaao-faq-a .oaao-answer {
  padding: 1rem 1.15rem;
  border-radius: 12px;
  background: {{card}};
  border-left: 4px solid {{accent}};
  font-size: 0.98rem;
  line-height: 1.45;
}
.oaao-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.5rem;
  flex: 1 1 auto;
  min-height: 320px;
  align-items: stretch;
}
.oaao-metric {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  padding: 1.75rem 1.25rem;
  border-radius: 16px;
  background: linear-gradient(145deg, {{card}}, color-mix(in srgb, {{bg}} 40%, {{card}}));
  border: 1px solid color-mix(in srgb, {{accent}} 18%, transparent);
}
.oaao-metric .val {
  font-size: 2.65rem;
  font-weight: 800;
  line-height: 1;
  color: {{accent}};
  margin-bottom: 0.35rem;
}
.oaao-metric .lbl { font-size: 0.95rem; color: {{muted}}; max-width: 12rem; }
.oaao-quote-row {
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 2.25rem;
  flex: 1 1 auto;
  min-height: 320px;
  align-items: center;
}
.oaao-quote-block {
  margin: 0;
  padding: 1.75rem 2rem;
  border-left: 8px solid {{accent}};
  font-size: 1.45rem;
  line-height: 1.45;
  font-weight: 600;
  color: {{fg}};
  background: color-mix(in srgb, {{card}} 85%, transparent);
  border-radius: 0 14px 14px 0;
}
.oaao-section-divider {
  display: flex;
  flex-direction: column;
  justify-content: center;
  flex: 1 1 auto;
  min-height: 720px;
  padding: 4rem 5rem;
  box-sizing: border-box;
  background: linear-gradient(135deg, color-mix(in srgb, {{accent}} 18%, {{bg}}), {{bg}});
}
.oaao-section-divider h1 {
  margin: 0 0 1rem;
  font-size: 3rem;
  color: {{accent}};
}
.oaao-section-divider .deck { color: {{muted}}; font-size: 1.2rem; }
.oaao-slide-canvas.oaao-variant-1 .oaao-slide-header h1 { font-size: 2rem; }
.oaao-slide-canvas.oaao-variant-2 .oaao-slide-body { padding-bottom: 2.75rem; }
