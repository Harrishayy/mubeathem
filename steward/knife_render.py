"""Dense, annotated display of unchanged knife physics and recorded decisions.

Every fourth original 240 Hz tick is rendered: no optical flow, pose
interpolation, control changes, or movement amplification. Canonical 20 Hz
measurements are independently verified at every shared tick.
"""
from __future__ import annotations

import hashlib
import math
from pathlib import Path
import tempfile
import time


def project_knife(telemetry,camera,width=640,height=480):
    """Project the actual knife profile, including its pointed nose, into pixels."""
    def subtract(a,b):return [x-y for x,y in zip(a,b)]
    def dot(a,b):return sum(x*y for x,y in zip(a,b))
    def unit(a):
        length=math.sqrt(dot(a,a));return [x/length for x in a]
    def cross(a,b):return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
    forward=unit(subtract(camera["target"],camera["eye"]));right=unit(cross(forward,[0,0,1]));up=cross(right,forward)
    tangent=math.tan(math.radians(camera["fov"])/2)
    x,y,z,w=telemetry["knife_orientation_xyzw"]
    rotation=[[1-2*y*y-2*z*z,2*x*y-2*z*w,2*x*z+2*y*w],
              [2*x*y+2*z*w,1-2*x*x-2*z*z,2*y*z-2*x*w],
              [2*x*z-2*y*w,2*y*z+2*x*w,1-2*x*x-2*y*y]]
    origin=telemetry["knife_grasp_m"]
    def project(local):
        world=[origin[i]+dot(rotation[i],local) for i in range(3)]
        relative=subtract(world,camera["eye"]);depth=dot(relative,forward)
        if depth<=0:raise RuntimeError("Knife geometry behind presentation camera")
        return [(1+dot(relative,right)/(depth*tangent*width/height))*width/2,
                (1-dot(relative,up)/(depth*tangent))*height/2]
    vertices=[]
    for lo,hi,half_y,half_z in ((-.075,.075,.023,.020),(.070,.086,.050,.027),(.08,.30,.039,.005)):
        vertices.extend([[xx,yy,zz] for xx in (lo,hi) for yy in (-half_y,half_y) for zz in (-half_z,half_z)])
    nose=[[.30,-.039,-.005],[.30,.039,-.005],[.365,0,-.005],[.30,-.039,.005],[.30,.039,.005],[.365,0,.005]]
    vertices.extend(nose)
    def bounds(points):
        points=[project(point) for point in points]
        return [min(p[0] for p in points),min(p[1] for p in points),max(p[0] for p in points),max(p[1] for p in points)]
    whole,tip=bounds(vertices),bounds(nose)
    def margin(box,crop_top=0,crop_height=height):
        return min(box[0],width-box[2],box[1]-crop_top,crop_top+crop_height-box[3])
    return {"whole_knife_bounds_px":whole,"nose_bounds_px":tip,"tip_center_px":project([.365,0,0]),
            "whole_knife_margin_px":margin(whole),"nose_margin_px":margin(tip),
            "stacked_whole_knife_margin_px":margin(whole,32,416),"stacked_nose_margin_px":margin(tip,32,416)}


def render_recording(payload: dict) -> dict:
    import imageio.v2 as imageio
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont
    from steward.knife_physics import KnifeWorld, prepare_action, provenance, digest

    started=time.monotonic()
    job,canonical=payload["job"],payload["canonical"]
    source=provenance(job)["source_sha256"]
    if source!=canonical["source_sha256"]:
        raise ValueError("Canonical physics source differs from replay source")
    canonical_job={**job,"render":False}
    if digest(canonical_job)!=canonical["job_sha256"]:
        raise ValueError("Canonical job differs from requested action replay")
    if len(job["steps"])!=len(canonical["steps"]):
        raise ValueError("Canonical action count mismatch")
    for requested,recorded in zip(job["steps"],canonical["steps"]):
        if requested["action"]!=recorded["requested_action"] or requested["execute"]!=recorded["execute"]:
            raise ValueError("Canonical action/decision mismatch")

    scene_source=None
    world_class=KnifeWorld
    if job.get("scenario")=="near-close":
        from steward.knife_close_scene import CloseKnifeWorld
        import steward.knife_close_scene as scene_module
        scene_source=hashlib.sha256(Path(scene_module.__file__).read_bytes()).hexdigest()
        if scene_source!=canonical.get("scene_source_sha256"):
            raise ValueError("Canonical close-scene source differs from replay source")
        world_class=CloseKnifeWorld
    world=world_class(job)
    original_human_camera=dict(world.cameras["human"])
    # This is the display camera only. The original world/observation camera,
    # eye origin, model images, actions and physical dynamics remain untouched.
    world.cameras["human"]={**world.cameras["human"],"target":[.62,-.04,1.10]}
    scratch=Path(tempfile.mkdtemp(prefix="knife-dense-"))
    raw_path,stacked_path=scratch/"raw.mp4",scratch/"stacked.mp4"
    writers=[]
    frame_times=[]
    verification={"shared_ticks":0,"max_joint_error_rad":0.,"max_tip_error_m":0.,"max_clearance_error_m":0.}
    optics={name:{"min_tool_extent_px":100000,"min_tool_pixels":100000,"frames":0} for name in ("human","side")}
    framing={name:{"min_whole_knife_margin_px":100000.,"min_nose_margin_px":100000.,"min_stacked_whole_knife_margin_px":100000.,"min_stacked_nose_margin_px":100000.,"frames":0} for name in ("human","side")}
    original_by_tick={round(float(row["t"])*240):row for row in canonical["trajectory"]}
    timeline=[{"kind":"initial_hold","start_s":0.,"end_s":.6,"step_index":None,"physics_start_s":0.,"physics_end_s":0.}]
    for index in range(len(job["steps"])):
        timeline.append({"kind":"action","start_s":round(.6+index*.6,6),"end_s":round(.6+(index+1)*.6,6),"step_index":index,"physics_start_s":round(index*.6,6),"physics_end_s":round((index+1)*.6,6)})
    end=.6+len(job["steps"])*.6
    timeline.append({"kind":"end_hold","start_s":round(end,6),"end_s":round(end+.6,6),"step_index":len(job["steps"])-1,"physics_start_s":len(job["steps"])*.6,"physics_end_s":len(job["steps"])*.6})
    font_path="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    fonts={size:ImageFont.truetype(font_path,size) for size in (13,15,16,18,20,22)}

    def errors(actual,expected):
        joint=max(abs(float(a)-float(b)) for a,b in zip(actual["joint_positions_rad"],expected["joint_positions_rad"]))
        tip=float(np.linalg.norm(np.asarray(actual["knife_tip_m"])-np.asarray(expected["knife_tip_m"])))
        clearance=abs(actual["knife_clearance_m"]-expected["knife_clearance_m"])
        return joint,tip,clearance

    def verify(actual,expected):
        joint,tip,clearance=errors(actual,expected)
        verification["max_joint_error_rad"]=max(verification["max_joint_error_rad"],joint)
        verification["max_tip_error_m"]=max(verification["max_tip_error_m"],tip)
        verification["max_clearance_error_m"]=max(verification["max_clearance_error_m"],clearance)
        if joint>1e-8 or tip>1e-8 or clearance>1e-8:
            raise RuntimeError(f"Dense replay diverged from canonical physics: {joint=}, {tip=}, {clearance=}")

    def arrow(draw,x1,x2,y,color,width=3):
        draw.line((x1,y,x2,y),fill=color,width=width)
        draw.polygon([(x2,y),(x2-6,y-4),(x2-6,y+4)],fill=color)

    def diagram(image,index,step,telemetry,progress,active):
        draw=ImageDraw.Draw(image)
        protected=job["variant"]=="protected"
        denied=protected and not step["execute"] and index>=0
        actual_label=str(step.get("label","recorded decision"))
        pulse=active and progress<.34
        accent="#54e3b3" if protected else "#ff985f"
        draw.rectangle((0,0,640,128),fill="#09141e")
        heading="WITH SAPLING" if protected else "WITHOUT SAPLING"
        status=(f"ACTION {index+1}/{len(job['steps'])}" if active or index>=0 else "READY")
        draw.text((12,6),heading,font=fonts[18],fill=accent)
        draw.text((435,7),status,font=fonts[16],fill="#dcecf6")
        if protected:
            labels=(["OpenVLA","Sapling","PENDING","ROBOT HELD"] if index<0 else
                    ["OpenVLA","Sapling","BLOCKED" if denied else "ALLOWED","ROBOT HELD" if denied else "ROBOT MOVES"])
            xs=[12,171,330,489];box_width=139
        else:
            labels=["OpenVLA","ROBOT READY" if index<0 else "ROBOT MOVES"];xs=[48,412];box_width=180
        for i,(x,label) in enumerate(zip(xs,labels)):
            blocked=denied and i>=2
            outline="#ff4d55" if blocked else accent
            fill="#581c2a" if blocked and pulse else "#142837"
            draw.rounded_rectangle((x,36,x+box_width,73),radius=6,fill=fill,outline=outline,width=2 if pulse else 1)
            text_width=draw.textlength(label,font=fonts[15])
            draw.text((x+(box_width-text_width)/2,46),label,font=fonts[15],fill="#ffffff")
            if i+1<len(xs):
                arrow(draw,x+box_width+4,xs[i+1]-5,55,"#ff4d55" if denied and i>=1 else accent,3 if pulse else 2)
        if index<0:
            draw.text((12,81),"AWAITING FIRST MODEL PROPOSAL",font=fonts[16],fill="#a5bbcc")
        elif denied:
            label="REJECTED — COMMAND BLOCKED" if actual_label in ("violation","insufficient_information","unsure","error") else "ROBOT HELD — PREVIOUS REJECTION"
            draw.text((12,81),label,font=fonts[18],fill="#ff6269")
            draw.text((410,83),f"Sapling: {actual_label}",font=fonts[13],fill="#f6c7cb")
        elif protected:
            draw.text((12,81),"COMMAND ALLOWED BY SAPLING",font=fonts[18],fill=accent)
        else:
            draw.text((12,81),"MODEL COMMAND REACHES THE MOTORS",font=fonts[16],fill=accent)
        cm=telemetry["knife_clearance_m"]*100
        draw.text((12,106),f"LIVE KNIFE CLEARANCE  {cm:.2f} cm",font=fonts[16],fill="#f2f7fc")
        draw.text((490,107),"60 fps native",font=fonts[15],fill="#a5bbcc")

    def capture(index,step,telemetry,progress,active,cached_cameras=None):
        cameras={}
        cache={}
        frame_projection={}
        for name in ("human","side"):
            projected=project_knife(telemetry,world.cameras[name])
            frame_projection[name]=projected
            for key,source_key in (("min_whole_knife_margin_px","whole_knife_margin_px"),("min_nose_margin_px","nose_margin_px"),("min_stacked_whole_knife_margin_px","stacked_whole_knife_margin_px"),("min_stacked_nose_margin_px","stacked_nose_margin_px")):
                framing[name][key]=min(framing[name][key],projected[source_key])
            framing[name]["frames"]+=1
            if min(projected["whole_knife_margin_px"],projected["nose_margin_px"],projected["stacked_whole_knife_margin_px"],projected["stacked_nose_margin_px"])<16:
                raise RuntimeError(f"Knife profile/nose violates 16px presentation border: {name} {projected}")
            if cached_cameras is None:
                rgb,visibility=world.camera(name,640,480)
                camera_image=Image.fromarray(rgb)
            else:
                camera_image,visibility=cached_cameras[name]
            if visibility["visible_tool_extent_px"]<20 or visibility["visible_tool_pixels"]<35:
                raise RuntimeError(f"Knife visibility failed: {name} {visibility}")
            optics[name]["min_tool_extent_px"]=min(optics[name]["min_tool_extent_px"],visibility["visible_tool_extent_px"])
            optics[name]["min_tool_pixels"]=min(optics[name]["min_tool_pixels"],visibility["visible_tool_pixels"])
            optics[name]["frames"]+=1
            cameras[name]=camera_image
            cache[name]=(camera_image,visibility)
        raw=Image.new("RGB",(1280,480));raw.paste(cameras["human"],(0,0));raw.paste(cameras["side"],(640,0))
        # A dedicated diagram band plus two unscaled, centrally cropped camera
        # panes preserves 2:3 web layout without drawing over the knife handle.
        stacked=Image.new("RGB",(640,960));stacked.paste(cameras["human"].crop((0,32,640,448)),(0,128));stacked.paste(cameras["side"].crop((0,32,640,448)),(0,544))
        diagram(stacked,index,step,telemetry,progress,active)
        draw=ImageDraw.Draw(stacked)
        for y,label in ((132,"HUMAN EYE VIEW"),(549,"SIDE CAMERA")):
            draw.rounded_rectangle((8,y,190,y+24),radius=4,fill="#09141e")
            draw.text((15,y+3),label,font=fonts[16],fill="#e8f3fb")
        writers[0].append_data(np.asarray(raw));writers[1].append_data(np.asarray(stacked))
        frame_times.append({"video_s":round(len(frame_times)/60,6),"physics_s":round(world.ticks/240,6),"step_index":None if index<0 else index,"knife_clearance_m":telemetry["knife_clearance_m"],"projected_knife":frame_projection})
        return cache

    try:
        initial=world.telemetry();verify(initial,canonical["initial"])
        for path in (raw_path,stacked_path):
            writers.append(imageio.get_writer(str(path),fps=60,codec="libx264",quality=None,macro_block_size=8,ffmpeg_log_level="error",output_params=["-pix_fmt","yuv420p","-movflags","+faststart","-crf","18","-preset","veryfast","-threads","1"]))
        first=job["steps"][0]
        # Presentation holds freeze physics time. Reuse the exact same camera
        # pixels for those identical frames; every advancing tick is rendered.
        hold_cameras=None
        for _ in range(36):hold_cameras=capture(-1,first,initial,1,False,hold_cameras)
        for index,step in enumerate(job["steps"]):
            command=prepare_action(world,step)
            for frame in range(36):
                current=world.telemetry();capture(index,step,current,frame/36,True)
                for _ in range(4):world.pb.stepSimulation(physicsClientId=world.client);world.ticks+=1
                if world.ticks in original_by_tick:
                    verify(world.telemetry(),original_by_tick[world.ticks]);verification["shared_ticks"]+=1
            verify(world.telemetry(),canonical["steps"][index]["after"])
        final=world.telemetry();verify(final,canonical["final"])
        hold_cameras=None
        for _ in range(36):hold_cameras=capture(len(job["steps"])-1,job["steps"][-1],final,1,False,hold_cameras)
        for writer in writers:writer.close()
        writers=[]
        if verification["shared_ticks"]!=len(canonical["trajectory"]):
            raise RuntimeError("Not every canonical physics tick was verified")
        return {"id":job["id"],"variant":job["variant"],"raw_video":raw_path.read_bytes(),"stacked_video":stacked_path.read_bytes(),
                "fps":60,"raw_size":[1280,480],"stacked_size":[640,960],"video_frames":len(frame_times),"duration_s":len(frame_times)/60,
                "playback_timeline":timeline,"frame_times":frame_times,"camera_visibility":optics,"projected_knife_framing":framing,"physics_verification":verification,
                "presentation_cameras":world.cameras,"original_human_camera":original_human_camera,"stacked_camera_crop":{"x":0,"y":32,"width":640,"height":416,"diagram_height":128},
                "physics_source_sha256":source,"scene_source_sha256":scene_source,"renderer_source_sha256":hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                "render_job_sha256":digest(job),"canonical_job_sha256":canonical["job_sha256"],"canonical_metrics":canonical["metrics"],
                "initial":initial,"final":final,"wall_seconds":round(time.monotonic()-started,3),
                "display":{"capture":"Every fourth original 240Hz physics tick","fps":60,"speed":1,"initial_hold_s":.6,"end_hold_s":.6,"optical_flow":False,"pose_interpolation":False,"action_scaling":False,"diagram":"Recorded proposal and decision times; animated pulse in first 0.2 seconds of each action"}}
    finally:
        for writer in writers:writer.close()
        world.close()
        for path in (raw_path,stacked_path):path.unlink(missing_ok=True)
        scratch.rmdir()
