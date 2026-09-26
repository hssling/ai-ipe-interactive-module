(() => {
  "use strict";

  const videos = [
    {
      id: "5Vg1aR1hOxY",
      title: "AI Supported Case Reasoning",
      purpose: "Use this before Activity 2 to notice how AI can support, but not replace, shared case reasoning.",
      activity: "Activity 2 · Build one shared plan",
    },
    {
      id: "zGi7rg2DpEQ",
      title: "Critical AI Literacy",
      purpose: "Use this during the assessment and Activity 1 to question confident outputs, omissions, evidence and bias.",
      activity: "Assessment + Activity 1 · Compare before you trust",
    },
    {
      id: "5hMRP0dCG7s",
      title: "Self Directed Learning",
      purpose: "Use this at the start of the module to plan your learning, monitor progress and identify the support you need.",
      activity: "Start here · Learning pathway",
    },
    {
      id: "lWEfq8kdWac",
      title: "AI in IPE Conversations",
      purpose: "Use this before group work to practise dialogue, role clarity, listening and respectful challenge across professions.",
      activity: "Activities 1–2 · Interprofessional dialogue",
    },
    {
      id: "sH9tuXjytoo",
      title: "IPEC V3: Evaluating AI Teams",
      purpose: "Use this during Activity 3 to connect the IPEC V3 competencies with evaluation, accountability and team performance.",
      activity: "Activities 3A–3B · Design and sustainability",
    },
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
