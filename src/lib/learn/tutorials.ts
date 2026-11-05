// "Learn to make it" — personalised Blender / Nomad Sculpt courses built from the project's own component graph,
// plus a runnable Blender Python script that creates the blockout scene. Lessons describe tools and steps;
// no application screenshots or recordings are claimed (visuals are renders of the user's own blockout).

import type { ComponentSpec } from "../geometry/types";
import { primitiveSize } from "../geometry/types";

export interface Lesson {
  n: number;
  title: string;
  objective: string;
  tools: string[];
  steps: string[];
  mistakes: string[];
  result: string;
  partIds: string[];
}

export interface Course {
  software: "blender" | "nomad";
  title: string;
  intro: string;
  lessons: Lesson[];
}

const fmt = (n: number) => Number(n.toFixed(1));
const dims = (c: ComponentSpec) => primitiveSize(c.primitive).map(fmt).join(" × ") + " mm";

export function blenderScript(projectName: string, comps: ComponentSpec[], referenceFiles: string[]): string {
  const lines: string[] = [];
  lines.push(`# PARTART blockout for "${projectName.replace(/"/g, "'")}"`);
  lines.push(`# Run in Blender 3.6+ / 4.x: Scripting workspace → Open → this file → Run Script.`);
  lines.push(`# Creates one object per component, named by part ID, at real size (millimetres).`);
  lines.push(`import bpy, bmesh, math, os`);
  lines.push(``);
  lines.push(`scene = bpy.context.scene`);
  lines.push(`scene.unit_settings.system = 'METRIC'`);
  lines.push(`scene.unit_settings.scale_length = 0.001`);
  lines.push(`scene.unit_settings.length_unit = 'MILLIMETERS'`);
  lines.push(`col = bpy.data.collections.get("PARTART") or bpy.data.collections.new("PARTART")`);
  lines.push(`if col.name not in scene.collection.children: scene.collection.children.link(col)`);
  lines.push(``);
  lines.push(`def mat(name, hex_):`);
  lines.push(`    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)`);
  lines.push(`    r, g, b = (int(hex_[i:i+2], 16) / 255 for i in (1, 3, 5))`);
  lines.push(`    m.diffuse_color = (r, g, b, 1)`);
  lines.push(`    return m`);
  lines.push(``);
  lines.push(`def finish(obj, name, loc, rot, color):`);
  lines.push(`    obj.name = name`);
  lines.push(`    obj.location = loc`);
  lines.push(`    obj.rotation_mode = 'XYZ'  # same convention as PARTART: X, then Y, then Z`);
  lines.push(`    obj.rotation_euler = tuple(math.radians(a) for a in rot)`);
  lines.push(`    obj.data.materials.append(mat(name + "_mat", color))`);
  lines.push(`    for c in obj.users_collection: c.objects.unlink(obj)`);
  lines.push(`    col.objects.link(obj)`);
  lines.push(``);
  lines.push(`def prism(name, pts, length):`);
  lines.push(`    # pts: (y, z) profile; extruded along X, centred`);
  lines.push(`    me = bpy.data.meshes.new(name); bm = bmesh.new()`);
  lines.push(`    a = [bm.verts.new((-length/2, y, z)) for y, z in pts]`);
  lines.push(`    b = [bm.verts.new(( length/2, y, z)) for y, z in pts]`);
  lines.push(`    bm.faces.new(a[::-1]); bm.faces.new(b)`);
  lines.push(`    n = len(pts)`);
  lines.push(`    for i in range(n): bm.faces.new((a[i], a[(i+1)%n], b[(i+1)%n], b[i]))`);
  lines.push(`    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()`);
  lines.push(`    obj = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(obj); return obj`);
  lines.push(``);
  for (const c of comps) {
    const name = `${c.partId}_${c.name.replace(/[^A-Za-z0-9]+/g, "_")}`;
    const p = c.primitive;
    const loc = `(${c.position.map(fmt).join(", ")})`;
    const rot = `(${c.rotation.map(fmt).join(", ")})`;
    lines.push(`# ${c.partId} — ${c.name} (${c.role}, ${c.provenance}, confidence ${Math.round(c.confidence * 100)} %)`);
    switch (p.type) {
      case "box":
        lines.push(`bpy.ops.mesh.primitive_cube_add(size=1)`);
        lines.push(`o = bpy.context.active_object; o.scale = (${fmt(p.w)}, ${fmt(p.d)}, ${fmt(p.h)})`);
        lines.push(`bpy.ops.object.transform_apply(scale=True)`);
        lines.push(`for v in o.data.vertices: v.co.z += ${fmt(p.h / 2)}`);
        break;
      case "cylinder":
        if (p.rTop !== undefined && Math.abs(p.rTop - p.r) > 0.01) lines.push(`bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=${fmt(p.r)}, radius2=${fmt(p.rTop)}, depth=${fmt(p.h)})`);
        else lines.push(`bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=${fmt(p.r)}, depth=${fmt(p.h)})`);
        lines.push(`o = bpy.context.active_object`);
        lines.push(`for v in o.data.vertices: v.co.z += ${fmt(p.h / 2)}`);
        break;
      case "ellipsoid":
        lines.push(`bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1)`);
        lines.push(`o = bpy.context.active_object; o.scale = (${fmt(p.w / 2)}, ${fmt(p.d / 2)}, ${fmt(p.h / 2)})`);
        lines.push(`bpy.ops.object.transform_apply(scale=True)`);
        lines.push(`for v in o.data.vertices: v.co.z += ${fmt(p.h / 2)}`);
        break;
      case "gable":
        lines.push(`o = prism("${name}", [(-${fmt(p.d / 2)}, 0), (${fmt(p.d / 2)}, 0), (0, ${fmt(p.h)})], ${fmt(p.w)})`);
        break;
      case "wedge":
        lines.push(`o = prism("${name}", [(-${fmt(p.d / 2)}, 0), (${fmt(p.d / 2)}, 0), (-${fmt(p.d / 2)}, ${fmt(p.h)})], ${fmt(p.w)})`);
        break;
      case "mesh":
        lines.push(`# Imported scan: File → Import the GLB from 02_3D_MODELS instead.`);
        lines.push(`o = None`);
        break;
    }
    lines.push(`if o: finish(o, "${name}", ${loc}, ${rot}, "${c.colorHex}")`);
    lines.push(``);
  }
  if (referenceFiles.length) {
    lines.push(`# Reference image(s) as image empties (paths relative to this script inside the PARTART kit).`);
    lines.push(`here = os.path.dirname(bpy.data.texts[0].filepath) if bpy.data.texts and bpy.data.texts[0].filepath else ""`);
    referenceFiles.forEach((f, i) => {
      lines.push(`p = os.path.normpath(os.path.join(here, "..", "..", "01_REFERENCE", ${JSON.stringify(f)}))`);
      lines.push(`if os.path.exists(p):`);
      lines.push(`    img = bpy.data.images.load(p)`);
      lines.push(`    e = bpy.data.objects.new("REF_${i + 1}", None); e.empty_display_type = 'IMAGE'; e.data = img`);
      lines.push(`    e.empty_display_size = 300; e.location = (0, ${300 + i * 20}, 150); e.rotation_euler = (math.radians(90), 0, 0)`);
      lines.push(`    col.objects.link(e)`);
    });
  }
  lines.push(`print("PARTART blockout created: ${comps.length} components")`);
  return lines.join("\n") + "\n";
}

export function buildCourse(software: "blender" | "nomad", projectName: string, category: string, comps: ComponentSpec[]): Course {
  const roots = comps.filter((c) => !c.parentPartId);
  const byRole = (r: string[]) => comps.filter((c) => r.includes(c.role));
  const organic = byRole(["head", "torso", "limb", "hand", "foot"]);
  const openings = byRole(["opening"]);
  const details = byRole(["detail", "accessory"]);
  const B = software === "blender";
  const lessons: Lesson[] = [];
  const add = (l: Omit<Lesson, "n">) => lessons.push({ ...l, n: lessons.length + 1 });
  const biggest = [...comps].sort((a, b) => Math.max(...primitiveSize(b.primitive)) - Math.max(...primitiveSize(a.primitive)))[0];

  add({
    title: "Understand the proportions",
    objective: `Read the size relationships of ${projectName} before modelling anything.`,
    tools: B ? ["Image empties", "Measure tool (Shift+Space → Measure)"] : ["Reference image (Scene → Reference)", "Ruler"],
    steps: [
      `The largest part is ${biggest?.name} (${biggest ? dims(biggest) : "-"}). Everything else is measured against it.`,
      ...comps.slice(0, 8).map((c) => `${c.partId} ${c.name}: ${dims(c)} — ${c.provenance === "observed" ? "seen in the photo" : c.provenance === "user" ? "your measurement" : "estimated, check against the photo"}.`),
      B ? "Load the reference photo as an image empty facing the front view (Numpad 1) and scale it so the main body matches its size." : "Import the reference image into the Nomad scene background and set its opacity to about 40 %.",
    ],
    mistakes: ["Modelling details before the big shapes are right.", "Mixing up metres and millimetres — set scene units first."],
    result: "A reference set up behind an empty scene with the correct units.",
    partIds: [],
  });
  add({
    title: B ? "Block out with primitives (or run the PARTART script)" : "Block out with primitives",
    objective: "Rough out every component as a simple shape at the right size and position.",
    tools: B ? ["Add → Mesh (Cube, Cylinder, UV Sphere)", "N-panel → Item (exact dimensions)", "Scripting workspace"] : ["Scene → Add primitive (Box, Cylinder, Sphere)", "Gizmo", "Primitive settings (size)"],
    steps: B
      ? ["Fastest: open 07_TUTORIALS/blender/build_blockout.py in the Scripting workspace and click Run — every part is created at true size, named by its part ID.", "Or build it by hand: for each part below add the primitive, then type its exact Dimensions in the N-panel.", ...roots.map((r) => `Start with ${r.partId} ${r.name} (${dims(r)}).`)]
      : ["Add one primitive per major part, starting from the base.", ...roots.map((r) => `${r.partId} ${r.name}: ${r.primitive.type}, ${dims(r)}.`), "Use the gizmo with snapping to align parts to each other."],
    mistakes: ["Scaling in Object mode and forgetting to apply scale (Ctrl+A → Scale) before modifiers."],
    result: "A grey blockout whose silhouette matches the reference from the front and side.",
    partIds: roots.map((r) => r.partId),
  });
  if (category === "figurines" || organic.length) {
    for (const [title, ids] of [
      ["Sculpt the head and face", organic.filter((c) => c.role === "head")],
      ["Build the torso", organic.filter((c) => c.role === "torso")],
      ["Build the limbs", organic.filter((c) => c.role === "limb")],
      ["Hands and feet", organic.filter((c) => c.role === "hand" || c.role === "foot")],
    ] as const) {
      if (!ids.length) continue;
      add({
        title,
        objective: `Turn ${ids.map((c) => c.name).join(", ")} from blockout shapes into sculpted forms.`,
        tools: B ? ["Sculpt mode", "Remesh (voxel size 0.5–1 mm)", "Draw, Clay Strips, Smooth, Crease brushes", "Symmetry X"] : ["Voxel remesh", "Clay, Move, Smooth, Crease tools", "Symmetry", "Layers"],
        steps: [
          B ? "Select the part, switch to Sculpt Mode, Remesh with voxel size ≈ 1 mm to start." : "Select the part and use Voxel Remesh at a low resolution to start.",
          "Enable X symmetry. Use Move / Grab first to match the silhouette from the front and side reference.",
          "Add volume with Clay Strips, then Smooth. Only after the big forms read correctly, Crease the edges (eyelids, lips, finger gaps).",
          ...ids.map((c) => `${c.partId} target size: ${dims(c)}.`),
        ],
        mistakes: ["Remeshing at very high resolution too early (slow, lumpy).", "Sculpting without checking the side view."],
        result: `${title.split(" ").slice(1).join(" ")} that match the reference proportions.`,
        partIds: ids.map((c) => c.partId),
      });
    }
    add({
      title: "Create joints for articulation",
      objective: "Make the parts separate and connectable so they can be printed and posed.",
      tools: B ? ["Boolean modifier (Difference)", "UV Sphere for ball joints"] : ["Boolean (Scene → Boolean)", "Sphere primitive"],
      steps: ["Decide which joints should move (neck, shoulders, hips, knees).", "Place a ball (Ø 8–12 mm at this scale) at each joint; subtract a socket 0.2–0.3 mm larger from the neighbouring part.", "Keep at least 1.6 mm of wall around every socket."],
      mistakes: ["Zero clearance — printed joints fuse.", "Sockets so deep the ball cannot snap in."],
      result: "Separate limb parts with matching ball-and-socket joints.",
      partIds: byRole(["joint"]).map((c) => c.partId),
    });
  } else {
    add({
      title: "Refine the main volumes",
      objective: "Add the bevels, thicknesses and inset faces that make the blockout read as the real object.",
      tools: B ? ["Edit mode: Inset (I), Extrude (E), Loop cut (Ctrl+R)", "Bevel modifier", "Solidify modifier"] : ["Primitive → Validate, then Split / Extrude", "Crease tool"],
      steps: [
        ...roots.map((r) => `${r.partId} ${r.name}: check its edges against the photo — add a small bevel (0.5–1 mm) so edges catch light.`),
        B ? "For hollow shells use a Solidify modifier with 2 mm thickness instead of modelling both faces." : "Keep hard-surface parts low-poly; Nomad is best for the organic details.",
      ],
      mistakes: ["Bevelling before applying scale (uneven bevels)."],
      result: "Clean main volumes with believable edges.",
      partIds: roots.map((r) => r.partId),
    });
  }
  if (openings.length)
    add({
      title: "Cut windows and doors",
      objective: `Create the ${openings.length} openings as clean holes with frames.`,
      tools: B ? ["Boolean modifier (Difference)", "Array modifier for repeated windows"] : ["Boolean subtract", "Box primitive"],
      steps: [...openings.map((o) => `${o.partId} ${o.name}: ${dims(o)} at x ${fmt(o.position[0])}, y ${fmt(o.position[1])}, z ${fmt(o.position[2])} mm.`), "Use one cutter object per opening; parent all cutters to the wall so they move together.", "Make frames as separate objects so they can be printed or cut separately."],
      mistakes: ["Applying the Boolean before positions are final.", "Cutter not fully passing through the wall (leaves a skin)."],
      result: "Walls with clean openings and separate frames.",
      partIds: openings.map((o) => o.partId),
    });
  if (details.length)
    add({
      title: "Refine details",
      objective: `Add the decorative details: ${details.map((d) => d.name).join(", ")}.`,
      tools: B ? ["Duplicate Linked (Alt+D)", "Mirror modifier"] : ["Instances / Repeaters", "Mirror"],
      steps: details.map((d) => `${d.partId} ${d.name}: ${dims(d)}.`),
      mistakes: ["Details thinner than 1 mm — they will not print; 2 × nozzle is the minimum."],
      result: "A detailed model that still prints and cuts cleanly.",
      partIds: details.map((d) => d.partId),
    });
  add({
    title: "Prepare separate components",
    objective: "Make every part a separate, watertight object named by its part ID.",
    tools: B ? ["3D-Print Toolbox add-on (Check All, Make Manifold)", "Separate (P)"] : ["Validate / Close holes", "Join / Separate"],
    steps: ["Name each object exactly as its part ID so the files match the PARTART kit.", B ? "Run 3D-Print Toolbox → Check All; fix non-manifold edges and thin walls." : "Use Voxel Remesh or Close Holes to make every object watertight.", "Check wall thickness ≥ 1.6 mm for FDM printing."],
    mistakes: ["Overlapping objects left joined — slicers merge them unpredictably."],
    result: "Clean, watertight, named components.",
    partIds: comps.map((c) => c.partId),
  });
  add({
    title: "Export and prepare for manufacturing",
    objective: "Export each part and bring it back into PARTART or your slicer.",
    tools: B ? ["File → Export → STL / glTF 2.0 (Selection only, Scale 1.0, units mm)"] : ["Export → STL / GLB / OBJ"],
    steps: ["Export every part as its own STL (millimetres, Z up) or the whole scene as GLB.", "Upload the GLB to PARTART (Create → 'I already have a 3D model') to get validation, orientation and print cards.", "Open STLs in PrusaSlicer, OrcaSlicer or Bambu Studio for print time and filament usage."],
    mistakes: ["Exporting in metres — parts come in 1000× too small."],
    result: "Files ready to print, and a PARTART project that can generate the rest of the kit.",
    partIds: [],
  });
  return {
    software,
    title: `${B ? "Blender" : "Nomad Sculpt"}: make your ${projectName}`,
    intro: B
      ? "A course built from your own component breakdown. Lesson 2 includes a script that builds the blockout for you. Visuals in PARTART are renders of your blockout, not screen recordings of Blender."
      : "A Nomad Sculpt course built from your component breakdown. Tool names follow Nomad's interface; visuals are renders of your blockout, not recordings of the app.",
    lessons,
  };
}

export function courseMarkdown(course: Course): string {
  const out = [`# ${course.title}`, "", course.intro, ""];
  for (const l of course.lessons) {
    out.push(`## ${l.n}. ${l.title}`, "", `**Objective:** ${l.objective}`, "", `**Tools:** ${l.tools.join(", ")}`, "", "**Steps:**");
    l.steps.forEach((s, i) => out.push(`${i + 1}. ${s}`));
    out.push("", "**Common mistakes:**");
    l.mistakes.forEach((m) => out.push(`- ${m}`));
    out.push("", `**Expected result:** ${l.result}`, "");
  }
  return out.join("\n");
}
