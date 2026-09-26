(() => {
  "use strict";

  const videos = [
    { id: "5hMRP0dCG7s", title: "Self Directed Learning", purpose: "Start here to plan your learning, monitor progress and identify the support you need.", activity: "Start here · Learning pathway" },
    { id: "al05uhMKnkQ", title: "AI in IPE Learning Videos", purpose: "Use this orientation video to connect the module theme with interprofessional learning.", activity: "Start here · Orientation" },
    { id: "zGi7rg2DpEQ", title: "Critical AI Literacy", purpose: "Question confident outputs, omissions, evidence and bias before you use an AI stimulus.", activity: "Assessment + Activity 1 · Compare before you trust" },
    { id: "u306daKhFyA", title: "Equity, Culture Identity", purpose: "Look for whose context, identity and lived experience may be missing from a plan or output.", activity: "Activity 1 · Equity audit" },
    { id: "lWEfq8kdWac", title: "AI in IPE Conversations", purpose: "Practise dialogue, role clarity, listening and respectful challenge across professions.", activity: "Activity 2 · Team conversation" },
    { id: "5Vg1aR1hOxY", title: "AI Supported Case Reasoning", purpose: "Notice how AI can support, but not replace, shared case reasoning.", activity: "Activity 2 · Build one shared plan" },
    { id: "11FtBKm8d8A", title: "Bounded AI Supported IPE", purpose: "Define a useful AI role with clear limits, verification and a no-AI fallback.", activity: "Activity 3A · Intervention design" },
    { id: "sH9tuXjytoo", title: "IPEC V3: Evaluating AI Teams", purpose: "Connect IPEC V3 competencies with evaluation, accountability and team performance.", activity: "Activity 3A · Evaluation plan" },
    { id: "-D3gpBKaCK4", title: "Sustainability Beyond Workshop", purpose: "Consider the conditions that help a promising learning intervention survive beyond its pilot.", activity: "Activity 3B · Sustainability appraisal" },
    { id: "a3QCrBPOZFs", title: "AI in Education Videos", purpose: "Extend the module with broader questions about responsible AI use in education and research.", activity: "Close · Further learning" },
  ];

  function addStyles() {
    if (document.getElementById("learning-video-styles")) return;
    const style = document.createElement("style");
    style.id = "learning-video-styles";
    style.textContent = `
      #video-library .video-intro { max-width: 70rem; }
      #video-library .video-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(275px, 1fr)); gap: 1rem; margin-top: 1.25rem; }
      #video-library .video-card { overflow: hidden; display: flex; flex-direction: column; }
      #video-library .video-frame { aspect-ratio: 16 / 9; background: #102f3e; }
      #video-library .video-frame iframe { width: 100%; height: 100%; border: 0; display: block; }
      #video-library .video-copy { padding: 1rem; display: flex; flex-direction: column; gap: .55rem; flex: 1; }
      #video-library .video-copy h3 { margin: 0; }
      #video-library .video-copy p { margin: 0; }
      #video-library .video-activity { color: var(--teal); font-size: .84rem; font-weight: 700; }
      #video-library .video-link { align-self: flex-start; margin-top: auto; }
      @media print { #video-library { break-before: page; } #video-library .video-frame { display: none; } }
    `;
    document.head.appendChild(style);
  }

  function addLibrary() {
    if (document.getElementById("video-library")) return;
    const start = document.getElementById("start");
    if (!start) return;
    const section = document.createElement("section");
    section.id = "video-library";
    section.innerHTML = `
      <h2>Video learning library</h2>
      <p class="lead video-intro">Watch the short videos at the suggested points in the pathway. They are learning stimuli, not substitutes for the module activities, professional judgement or local policy. If a video is unavailable, use its title and link to open it directly on YouTube.</p>
      <div class="notice privacy"><strong>Privacy note.</strong> The embedded player is provided by YouTube. Do not enter personal, patient or restricted information in comments, prompts or linked services.</div>
      <div class="video-grid">
        ${videos.map((video) => `
          <article class="card accent video-card">
            <div class="video-frame">
              <iframe src="https://www.youtube-nocookie.com/embed/${video.id}" title="${video.title}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
            </div>
            <div class="video-copy">
              <h3>${video.title}</h3>
              <p class="video-activity">Suggested point: ${video.activity}</p>
              <p class="small">${video.purpose}</p>
              <a class="button outline video-link" href="https://youtu.be/${video.id}" target="_blank" rel="noopener noreferrer">Open on YouTube ↗</a>
            </div>
          </article>`).join("")}
      </div>
      <div class="card gold" style="margin-top:1rem">
        <label for="videoReflection"><strong>Optional video reflection</strong> · What idea from the videos will you apply in your next activity?</label>
        <textarea id="videoReflection" data-save placeholder="Note one idea, question or action..."></textarea>
      </div>`;
    start.insertAdjacentElement("afterend", section);
    const assessmentLink = document.querySelector('nav a[href="#assessment"]');
    if (assessmentLink && !document.querySelector('nav a[href="#video-library"]')) {
      assessmentLink.insertAdjacentHTML("beforebegin", '<a href="#video-library">Videos</a>');
    }
  }

  addStyles();
  addLibrary();
})();
