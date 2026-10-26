// Static markup for the studio, rendered once and then driven by controller.ts.
export const MARKUP = /* html */ `
<div class="app">
  <header>
    <h1><a href="/">Cyanotype <span>Negative</span> Studio</a></h1>
    <div class="spacer"></div>
    <span class="savestatus" id="saveStatus"></span>
    <button id="btnCalibrate">Calibrate my process…</button>
    <button id="btnHelp">How it works</button>
    <div class="user"><img id="userAvatar" alt="" hidden><span id="userName"></span><form action="/auth/signout" method="post"><button type="submit">Sign out</button></form></div>
  </header>

  <aside id="panel">
    <!-- 1 -->
    <section class="step" id="s-open">
      <h2><span class="n">1</span>Open a photo<span class="chev">▾</span></h2>
      <div class="body">
        <div class="drop" id="drop">Click to choose a photo<br><small>or drag one anywhere onto this window</small></div>
        <input type="file" id="file" accept="image/*,.tif,.tiff,.heic" hidden>
        <div class="fileinfo" id="fileinfo">JPEG, PNG, WebP. TIFF and HEIC open in Safari. (RAW files: export a JPEG/TIFF from Lightroom first.)</div>
      </div>
    </section>

    <!-- 2 -->
    <section class="step" id="s-crop">
      <h2><span class="n">2</span>Crop &amp; rotate<span class="chev">▾</span></h2>
      <div class="body">
        <div class="btns tight">
          <button id="rotL" title="Rotate left">⟲ Rotate</button>
          <button id="rotR" title="Rotate right">⟳ Rotate</button>
          <button id="flipH" title="Flip the photo itself (not the print mirror)">⇋ Flip</button>
        </div>
        <div class="grid2">
          <div class="row"><label>Aspect ratio</label>
            <select id="aspect">
              <option value="free">Free</option><option value="orig">Original</option>
              <option value="1">Square 1:1</option><option value="0.8">4:5 (8×10)</option><option value="1.25">5:4 (10×8)</option>
              <option value="0.7143">5:7</option><option value="1.4">7:5</option><option value="0.6667">2:3</option><option value="1.5">3:2</option>
            </select></div>
          <div class="btns" style="margin:4px 0"><button id="cropBtn">✂ Crop…</button><button id="cropReset">Reset</button></div>
        </div>
      </div>
    </section>

    <!-- 3 -->
    <section class="step" id="s-bw">
      <h2><span class="n">3</span>Black &amp; white and tone<span class="chev">▾</span></h2>
      <div class="body">
        <div class="tip">Like a coloured filter on a film camera: choose which colours become light or dark. <b>Red</b> darkens blue skies, <b>green</b> lightens foliage.</div>
        <div class="btns tight" id="filters"></div>
        <div id="bwSliders"></div>
        <div class="sub">Tone</div>
        <div class="tip">Make the black &amp; white look the way you want the final print to look. The negative curve (step 4) takes care of the cyanotype's quirks.</div>
        <div id="toneSliders"></div>
        <div class="btns tight"><button id="toneReset">Reset tone</button></div>
      </div>
    </section>

    <!-- 4 -->
    <section class="step" id="s-neg">
      <h2><span class="n">4</span>Negative &amp; curve<span class="chev">▾</span></h2>
      <div class="body">
        <div class="tip">Cyanotype only reproduces part of the tonal range of an uncorrected negative — the lightest and darkest tones merge. The curve stretches your tones to fit. Check the <b>Cyanotype</b> view and the strip at the bottom.</div>
        <div class="row"><label>Process profile</label><select id="profile"></select></div>
        <div class="profilemeta" id="profileMeta"></div>
        <div id="modelSliders"></div>
        <div class="btns">
          <button class="primary" id="fitCurve" title="Build the curve that makes the predicted print match your black & white">✦ Auto-fit curve</button>
          <button id="linCurve" title="No correction: a plain inverted image">Linear</button>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:10px">
          <span class="sub" style="margin:0">Negative curve</span><span class="badge" id="curveBadge">Edited</span>
          <span style="margin-left:auto;font-size:11px;color:var(--muted)" id="curveReadout"></span>
        </div>
        <div id="curveWrap"><canvas id="curve" width="560" height="560"></canvas></div>
        <div class="curvelabels"><span>← dense ink (paper white)</span><span>clear film (deep blue) →</span></div>
        <div class="tip">Click to add a point, drag to move, double-click (or drag off the box) to remove. The faint bars show where your photo's tones sit.</div>
        <div class="grid2">
          <div class="row"><label>My curves</label><select id="savedCurves"><option value="">—</option></select></div>
          <div class="btns tight" style="margin:4px 0"><button id="saveCurve">Save…</button><button id="delCurve">Delete</button></div>
        </div>
        <div class="btns tight">
          <button id="exportAcv" title="Photoshop curve file, applied after inverting">Export .acv</button>
          <button id="importCurve">Import .acv / .cube…</button>
          <input type="file" id="curveFile" accept=".acv,.cube,.txt,.csv" hidden>
        </div>
        <label class="check"><input type="checkbox" id="importPositive"> Imported curve was made for the positive (applied before inverting, as in EDN)</label>
      </div>
    </section>

    <!-- 5 -->
    <section class="step" id="s-print">
      <h2><span class="n">5</span>Print the negative<span class="chev">▾</span></h2>
      <div class="body">
        <div class="grid2">
          <div class="row"><label>Image width (inches)</label><input type="number" id="pWidth" min="1" max="40" step="0.25"></div>
          <div class="row"><label>Resolution</label>
            <select id="pDpi"><option>300</option><option>360</option><option>600</option><option>720</option></select></div>
          <div class="row"><label>Border (inches)</label><input type="number" id="pBorder" min="0" max="3" step="0.125"></div>
          <div class="row"><label>Border type</label>
            <select id="pBorderType"><option value="black">Black → white paper edge</option><option value="clear">Clear → blue edge</option></select></div>
        </div>
        <div class="fileinfo" id="printInfo"></div>
        <label class="check"><input type="checkbox" id="pMirror"> Mirror (flip) for printing — ink side touches the paper</label>
        <label class="check"><input type="checkbox" id="pTablet"> Add a 21-step tablet below the image</label>
        <label class="check" style="padding-left:20px"><input type="checkbox" id="pTabletCorr"> Apply the curve to the tablet (prints as even steps when calibrated)</label>
        <div class="btns">
          <button class="primary" id="exportPng">⬇ Save negative (PNG)</button>
          <button id="printNow">Print…</button>
        </div>
        <div class="tip">
          <b>Printing tips:</b> print on inkjet transparency film, on the rough (coated) side. Use your printer's best quality, <b>colour</b> mode (not greyscale), and turn colour management off ("Printer manages colours" or "No colour adjustment"). Always print negatives with the same settings you used for your calibration tablet. Let the ink dry before contact printing.
        </div>
      </div>
    </section>
  </aside>

  <main>
    <div class="viewbar">
      <div class="seg" id="views">
        <button data-v="orig">Original</button>
        <button data-v="bw">B&amp;W</button>
        <button data-v="neg">Negative</button>
        <button data-v="cyan">Cyanotype</button>
        <button data-v="compare">Compare</button>
      </div>
      <div class="info" id="viewInfo"></div>
    </div>
    <div class="stage" id="stage">
      <canvas id="view" width="10" height="10"></canvas>
      <div class="empty" id="empty"><div><h3>Open a photo to begin</h3>Choose a file on the left, or drag one onto this window.<br><br>You can already play with the curve: the strip below shows how a grey scale would print.</div></div>
      <div class="cropbar" id="cropbar"><span style="color:var(--muted);font-size:12px">Drag to draw the crop · drag inside to move</span><button class="primary" id="cropDone">Done</button></div>
    </div>
    <div class="strip">
      <div class="names"><span>Ideal print</span><span>Your negative</span><span>Predicted print</span></div>
      <canvas id="strip" width="1400" height="120"></canvas>
      <div class="stat"><b id="distinct">–</b>distinct tones of 21 in the predicted print</div>
    </div>
  </main>
</div>

<!-- Calibration dialog -->
<dialog id="calDlg">
  <div class="dlg-head"><h2>Calibrate for your paper, chemistry and light</h2><div style="flex:1"></div><button id="calClose">Close</button></div>
  <div class="dlg-body">
    <p>The built-in "Generic cyanotype" profile is only an estimate. Cyanotype results vary a lot with paper, sensitizer, UV source, printer and film. A calibration measures <i>your</i> process once, so the curve and the preview match your real prints.</p>
    <h3>1 · Print the calibration sheet</h3>
    <p>One full page of film with a band for each exposure time. Every band has two 21-step tablets: a <b>linear</b> one (for calibrating) and one with your <b>current curve</b> (to check it — a good curve prints as even steps). It's already inverted and mirrored. Print it on transparency film at 100% scale, with exactly the settings you'll use for negatives.</p>
    <div class="calfields">
      <div class="row"><label>Exposure times (minutes)</label><input type="text" id="sheetTimes" value="5, 10, 15, 20"></div>
      <div class="row"><label>Film size</label><select id="sheetSize"><option value="letter">US Letter (8.5 × 11 in)</option><option value="a4">A4 (210 × 297 mm)</option></select></div>
    </div>
    <p id="sheetPlan" style="color:var(--muted)"></p>
    <div class="btns"><button class="primary" id="dlSheet">⬇ Save calibration sheet</button><button id="printSheet">Print sheet…</button></div>
    <div class="btns tight"><span style="align-self:center;color:var(--muted);font-size:12px">Single strips:</span><button id="dlTablet">Linear</button><button id="dlTabletCorr" title="To check a finished calibration: should print as even steps">Current curve</button></div>
    <h3>2 · Expose it and find your exposure time</h3>
    <ol>
      <li>Lay the film on the sensitized paper and expose the whole sheet. Each time on the list comes up, slide an opaque card down to the next marked line (the ticks in the margins), covering one more band. The top band gets the shortest time, the bottom band the longest.</li>
      <li>Develop and dry fully — cyanotype darkens as it dries.</li>
      <li>In the <b>linear</b> rows, pick the <b>shortest</b> time at which the last few patches (19–21, clearest film) have all merged into the same deepest blue, while patches 1–2 stay paper white. This "standard printing time" idea is how Christina Z. Anderson approaches it in her cyanotype and digital-negative books.</li>
      <li>From now on always use that time, paper and chemistry.</li>
    </ol>
    <h3>3 · Read your print</h3>
    <p>Scan or photograph the dry print (even light, no colour correction). Then click patch 1 and patch 21 of the <b>linear</b> row in the band you picked. Patch 1 is the lightest, patch 21 the darkest.</p>
    <div class="tabs"><button class="on" id="tabScan">From a scan</button><button id="tabType">Type values</button></div>
    <div id="paneScan">
      <div class="btns"><button id="loadScan">Choose scan…</button><input type="file" id="scanFile" accept="image/*,.tif,.tiff" hidden><span id="scanStatus" style="align-self:center;color:var(--muted);font-size:12px"></span></div>
      <canvas id="scanCanvas" class="hidden"></canvas>
    </div>
    <div id="paneType" class="hidden">
      <p>Enter 21 readings from patch 1 (lightest) to 21 (darkest), separated by commas or spaces. Use Lab "L" values (0–100) or grey values (0–255) from an eyedropper.</p>
      <textarea id="typedVals" placeholder="94, 93, 91, 88, 84, 79, …"></textarea>
      <div class="btns"><button id="useTyped">Use these values</button></div>
    </div>
    <canvas id="calChart" width="1600" height="340"></canvas>
    <p id="calSummary" style="color:var(--muted)">No readings yet.</p>
    <h3>4 · Save it</h3>
    <div class="row"><label>Save to</label><select id="calTarget"><option value="new">A new process profile</option></select></div>
    <div class="calfields" id="calNewFields">
      <div class="row wide"><label>Profile name</label><input type="text" id="calName" placeholder="e.g. Arches Platine · sunlight"></div>
      <div class="row"><label>Paper</label><input type="text" id="calPaper" placeholder="e.g. Arches Platine"></div>
      <div class="row"><label>Light source</label><input type="text" id="calLight" placeholder="e.g. sunlight, UV lightbox 365 nm"></div>
      <div class="row"><label>Sensitizer</label><input type="text" id="calSensitizer" placeholder="e.g. classic 2-part"></div>
      <div class="row"><label>Printer &amp; film</label><input type="text" id="calPrinter" placeholder="e.g. Epson P700 · Pictorico"></div>
    </div>
    <div class="calfields">
      <div class="row"><label>Exposure of the band you read (minutes)</label><input type="number" id="calExposure" min="0" step="0.5"></div>
      <div class="row"><label>Conditions</label><input type="text" id="calConditions" placeholder="e.g. clear sky, noon, July"></div>
    </div>
    <div class="btns"><button class="primary" id="calSave" disabled>Save &amp; use</button></div>
    <div class="btns tight"><button id="calDelete">Delete selected profile</button></div>
  </div>
</dialog>

<!-- Help dialog -->
<dialog id="helpDlg">
  <div class="dlg-head"><h2>How digital negatives for cyanotype work</h2><div style="flex:1"></div><button id="helpClose">Close</button></div>
  <div class="dlg-body">
    <h3>The short version</h3>
    <ol>
      <li><b>Edit</b> your photo as a black &amp; white positive that looks the way you want the print to look.</li>
      <li>The app <b>inverts</b> it into a negative: light areas of the photo become dark ink that blocks UV, so the paper stays white there.</li>
      <li>A <b>curve</b> corrects the negative. Cyanotype only "sees" part of the tonal range — without correction prints come out contrasty, with lost highlights and blocked shadows.</li>
      <li>The negative is <b>mirrored</b> so the ink side can touch the paper (sharper prints), then printed on transparency film.</li>
    </ol>
    <h3>About the preview</h3>
    <p>The Cyanotype view simulates the print by running your negative through a model of the process. With the Generic profile it's an educated guess; after you calibrate (header button), it uses your measured tones and even the actual blues and paper colour of your scan.</p>
    <h3>Reading the strip at the bottom</h3>
    <p>"Ideal print" is a perfectly even 21-step scale in cyanotype colours. "Predicted print" is what your current negative curve would give you. The closer they match, and the more distinct tones you get, the better. Try clicking <b>Linear</b> and then <b>Auto-fit</b> to see the difference.</p>
    <h3>Good starting photos</h3>
    <p>Images with clear shapes, good midtone separation and not too many large deep-shadow areas tend to print well. Cyanotype is a fairly short-scale process with a beautiful but limited range of blues.</p>
    <h3>Further reading</h3>
    <p>Christina Z. Anderson's books (e.g. <i>Cyanotype: The Blueprint in Contemporary Practice</i>), Peter Mrhar's Easy Digital Negatives site and manual, and Mark Nelson's Precision Digital Negatives cover calibration in depth.</p>
    <p>Everything runs on your computer — your photos never leave it. Settings, curves and calibrations are saved to your account, so they follow you to any computer.</p>
  </div>
</dialog>
`;
