"""Build original game-ready houses and a neighborhood in Blender. Run with blender -b -P art/build_town.py."""
import bpy, math, random, json, os
from mathutils import Vector, Matrix
from pathlib import Path
random.seed(42)
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public'/'models'
ART=ROOT/'art'
OUT.mkdir(parents=True,exist_ok=True); ART.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
M={}
def mat(name,hex,rough=.8,metal=0):
    # Design swatches are sRGB; Blender node colors and glTF factors are linear.
    # Writing sRGB numbers directly here made the exported town look washed out.
    srgb=tuple(int(hex[i:i+2],16)/255 for i in (0,2,4))
    c=tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in srgb)
    m=bpy.data.materials.new(name); m.diffuse_color=(*c,1); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
    M[name]=m;return m
PALETTE={
    'plaster':'FFD45E','plaster_blue':'49BFFF','plaster_rose':'FF8E74',
    'plaster_white':'FFF4DE','roof':'2666C5','roof_light':'4D8FED',
    'roof_rust':'F15B36','roof_rust_light':'FF8755','trim':'FFF9E9',
    'wood':'98613B','door':'1B75AA','metal':'254866','glass':'167CBD',
    'glass_light':'8CE8FF','stone':'87959E','asphalt':'485B70',
    'walk':'D7DCE3','grass':'63C838','grass_dark':'46AE35',
    'leaf':'238A35','leaf_light':'4DBB37','leaf_bright':'8DD845',
    'trunk':'795039','yellow':'FFC928','white':'FFFDF4','red':'FF5138',
    'blue':'279AF5','pot':'E77040','flower':'FFCE2C','rubber':'24313C','water':'35B7ED',
}
for n,c in PALETTE.items():mat(n,c,.27 if n.startswith('glass') else .85,.2 if n=='metal' else 0)
def p(x,y,z):return (x,-z,y)
def box(name,loc,dim,material,bevel=0,rot=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=p(*loc));o=bpy.context.object;o.name=name;o.dimensions=(dim[0],dim[2],dim[1]);o.rotation_euler.z=rot
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(M[material])
    if bevel:
        m=o.modifiers.new('Soft manufactured edges','BEVEL');m.width=bevel;m.segments=2
        bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=m.name)
        o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL')
    return o
def mesh(name,verts,faces,material):
    me=bpy.data.meshes.new(name);me.from_pydata([p(*v) for v in verts],[],faces);me.update()
    o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);o.data.materials.append(M[material]);return o
def cyl(name,loc,r,depth,material,verts=12,r2=None):
    if r2 is None:bpy.ops.mesh.primitive_cylinder_add(vertices=verts,radius=r,depth=depth,location=p(*loc))
    else:bpy.ops.mesh.primitive_cone_add(vertices=verts,radius1=r,radius2=r2,depth=depth,location=p(*loc))
    o=bpy.context.object;o.name=name;o.data.materials.append(M[material]);return o
def ico(name,loc,scale,material,sub=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub,radius=1,location=p(*loc));o=bpy.context.object;o.name=name;o.scale=(scale[0],scale[2],scale[1]);o.data.materials.append(M[material]);return o
def beam(name,a,b,r,material):
    av,bv=Vector(p(*a)),Vector(p(*b));v=bv-av
    bpy.ops.mesh.primitive_cylinder_add(vertices=8,radius=r,depth=v.length,location=(av+bv)/2)
    o=bpy.context.object;o.name=name;o.rotation_euler=v.to_track_quat('Z','Y').to_euler();o.data.materials.append(M[material]);return o
def tx(objects,x,y,z,yaw=0):
    m=Matrix.Translation(Vector(p(x,y,z)))@Matrix.Rotation(yaw,4,'Z')
    for o in objects:o.matrix_world=m@o.matrix_world
def since(before):return [o for o in bpy.context.scene.objects if o not in before and o.type=='MESH']
def merge(objects,prefix):
    result=[]
    # Merge per material; keep mesh complexity without a draw call per window or roof tile.
    buckets={}
    for o in objects:
        if o.type=='MESH':buckets.setdefault(o.data.materials[0].name,[]).append(o)
    bpy.ops.object.select_all(action='DESELECT')
    for name,parts in buckets.items():
        for o in parts:
            bpy.context.view_layer.objects.active=o
            for modifier in list(o.modifiers):
                try:bpy.ops.object.modifier_apply(modifier=modifier.name)
                except:pass
            o.select_set(True)
        bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();o=bpy.context.object;o.name=prefix+'_'+name
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        result.append(o);o.select_set(False)
    return result
def window(x,y,z,w=1.45,h=1.35,yaw=0):
    before=set(bpy.context.scene.objects)
    box('Window_recess',(0,0,0),(w+.22,h+.22,.14),'door')
    box('Reflective_glass',(0,0,.085),(w,h,.045),'glass')
    for xx in [-w/2,w/2]:box('Window_jamb',(xx,0,.15),(.095,h+.16,.14),'trim')
    for yy in [-h/2,h/2]:box('Window_lintel',(0,yy,.15),(w+.12,.09,.14),'trim')
    box('Window_mullion',(0,0,.16),(.055,h,.07),'trim')
    box('Window_sash',(0,-.12,.16),(w,.05,.07),'trim')
    box('Glass_reflection',(-w*.29,h*.24,.12),(.14,h*.30,.01),'glass_light')
    box('Window_sill',(0,-h/2-.1,.20),(w+.35,.13,.38),'trim',.02)
    tx(since(before),x,y,z,yaw)
def pot(x,y,z,flowers=False):
    cyl('Terracotta_pot',(x,y+.24,z),.27,.48,'pot',12,.33)
    cyl('Pot_lip',(x,y+.48,z),.35,.09,'pot')
    ico('Plant',(x,y+.72,z),(.38,.40,.38),'leaf_light',1)
    if flowers:
        for a in range(3):ico('Flowers',(x+math.sin(a*2)*.23,y+.9,z+math.cos(a*2)*.2),(.12,.12,.12),'flower')
def house(style=0):
    before=set(bpy.context.scene.objects);wall=['plaster','plaster_blue','plaster_rose'][style]
    roof='roof_rust' if style==2 else 'roof';rl='roof_rust_light' if style==2 else 'roof_light'
    box('Raised_masonry_foundation',(0,.0,0),(8,.7,6.7),'stone',.045)
    box('Ground_storey',(0,1.5,0),(7.6,2.6,6.2),wall,.025)
    box('Upper_storey',(0,4.05,0),(7.6,2.5,6.2),wall,.025)
    box('Floor_trim',(0,2.7,0),(7.75,.17,6.35),'trim')
    # Gables are modelled solids, and roof has thickness and visible individual courses.
    for z in [-3.1,3.1]:
        mesh('Gable',[(-3.8,5.3,z),(3.8,5.3,z),(0,7.15,z)],[(0,1,2)],wall)
    for side in [-1,1]:
        verts=[(0,7.22,-3.65),(side*4.3,5.2,-3.65),(side*4.3,5.2,3.65),(0,7.22,3.65),(0,7.07,-3.65),(side*4.3,5.05,-3.65),(side*4.3,5.05,3.65),(0,7.07,3.65)]
        mesh('Thick_pitched_roof',verts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],roof)
        for i in range(1,12):
            x=side*i*4.3/12;y=7.24-abs(x)*2.02/4.3
            beam('Roof_tile_course',(x,y,-3.68),(x,y,3.68),.032,rl)
        for j in range(14):
            z=-3.5+j*.53
            beam('Roof_tile_seam',(side*.10,7.25,z),(side*4.29,5.28,z),.017,rl)
        for z in [-3.7,3.7]:beam('Gable_fascia',(0,7.17,z),(side*4.35,5.14,z),.065,'trim')
        beam('Rain_gutter',(side*4.30,5.15,-3.65),(side*4.30,5.15,3.65),.085,'metal')
        beam('Downpipe',(side*3.87,.25,2.9),(side*3.87,5.1,2.9),.06,'metal')
    beam('Ridge_cap',(0,7.25,-3.75),(0,7.25,3.75),.09,rl)
    box('Chimney',(-2,6.8,-1.8),(.65,1.8,.65),'stone',.04)
    box('Chimney_cap',(-2,7.75,-1.8),(.85,.15,.85),'trim')
    for x in [-2.05,2.05]:window(x,3.95,3.16,1.55,1.45)
    window(-1.9,1.5,3.16,2.1,1.55)
    for z in [-1.7,1.6]:
        for x in [-3.84,3.84]:
            window(x,3.9,z,1.35,1.35,(-1 if x<0 else 1)*math.pi/2)
            window(x,1.45,z,1.3,1.25,(-1 if x<0 else 1)*math.pi/2)
    for x in [-2,2]:window(x,3.9,-3.16,1.45,1.4,math.pi)
    box('Front_door',(1.85,1.22,3.18),(1.30,2.15,.18),'door',.025)
    box('Door_glass',(1.85,1.55,3.29),(.84,1.01,.04),'glass')
    beam('Door_handle',(2.27,.90,3.34),(2.27,1.15,3.34),.035,'yellow')
    for i in range(3):box('Entrance_step',(1.85,.10+i*.09,3.9-i*.24),(2.0,.18,1.1-i*.22),'stone',.025)
    # Usable-looking balcony with deck slats, brackets and narrow railings.
    box('Balcony_floor',(0,2.78,3.8),(6.7,.18,1.45),'wood',.025)
    for x in [-3.24,3.24]:
        beam('Balcony_support',(x,1.95,3.13),(x,2.70,4.38),.065,'metal')
        beam('Balcony_side_rail',(x,3.70,3.15),(x,3.70,4.42),.04,'trim')
    for i in range(25):
        x=-3.2+i*6.4/24
        box('Deck_board',(x,2.89,3.8),(.22,.035,1.36),'wood')
        beam('Balcony_baluster',(x,2.9,4.42),(x,3.70,4.42),.025,'metal')
    beam('Balcony_top_rail',(-3.30,3.72,4.42),(3.30,3.72,4.42),.055,'trim')
    box('Porch_roof',(1.85,2.50,3.95),(2.7,.15,1.85),roof,.04)
    for x in [.65,3.05]:box('Porch_post',(x,1.28,4.65),(.11,2.4,.11),'trim')
    box('Address_plaque',(2.91,1.77,3.2),(.28,.18,.06),'trim')
    box('Porch_lamp',(.90,2.03,3.32),(.22,.30,.22),'yellow',.03)
    box('Flower_box',(-1.9,.6,3.55),(2.0,.33,.45),'wood',.025)
    for i in range(6):pot(-2.7+i*.32,.65,3.55,True)
    pot(-3.1,.35,4.3);pot(2.7,2.9,3.9,True)
    return merge(since(before),'House_'+str(style))
def export(objects,path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_extras=True,export_yup=True,export_materials='EXPORT',export_cameras=False,export_lights=False)
    bpy.ops.object.select_all(action='DESELECT')
def lighting(camloc=(15,12,19),target=(0,3,0),ortho=18):
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24
    scene.world.color=(.32,.38,.43)
    scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.76,.86,1,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.5
    bpy.ops.object.light_add(type='AREA',location=p(-9,17,10));light=bpy.context.object;light.data.energy=1100;light.data.shape='DISK';light.data.size=10
    bpy.ops.object.light_add(type='SUN',location=p(-20,30,-10));sun=bpy.context.object;sun.data.energy=2;sun.rotation_euler=(.4,-.5,-.7);sun.data.angle=.14
    bpy.ops.object.camera_add(location=p(*camloc));cam=bpy.context.object;cam.rotation_euler=(Vector(p(*target))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=ortho;scene.camera=cam
    scene.render.resolution_x=1100;scene.render.resolution_y=900;scene.render.resolution_percentage=100
    scene.view_settings.view_transform='Standard';scene.view_settings.exposure=-.15
    return [light,sun,cam]
# Save a separately editable hero house and a clean render.
hero=house(0);export(hero,OUT/'house.glb')
ground=box('Studio_ground',(0,-.47,0),(200,.15,200),'grass')
studio=lighting()
bpy.ops.wm.save_as_mainfile(filepath=str(ART/'hillside-house.blend'))
bpy.context.scene.render.filepath=str(ART/'hillside-house.png');bpy.ops.render.render(write_still=True)
for o in studio+[ground]:bpy.data.objects.remove(o,do_unlink=True)
templates=[hero,house(1),house(2)]
# Hide templates by moving them; town copies keep shared mesh data until the final merge.
alltown=[];colliders=[];prop_spawns=[]
def H(z):return max(0,min(7,(-z-10)*.18))
def terrain_rect(name,x0,x1,z0,z1,material,offset=.0):
    zs=sorted(set([z0,z1]+[z for z in [-49,-10] if z0<z<z1]))
    verts=[(x,H(z)+offset,z) for z in zs for x in [x0,x1]]
    faces=[(i*2,i*2+1,i*2+3,i*2+2) for i in range(len(zs)-1)]
    o=mesh(name,verts,faces,material);alltown.append(o);return o
floor=terrain_rect('Ground',-82,82,-73,74,'grass')
# The collision surface exactly follows the visible height profile.
colliders.append({'kind':'terrain','xs':[-82,82],'zs':[-73,-49,-10,74]})
terrain_rect('Main_boulevard',-6.8,6.8,-64,60,'asphalt',.045)
terrain_rect('East_lane',26,37,-57,54,'asphalt',.045)
for z in [-48,7,45]:
    terrain_rect('Cross_street',-48,58,z-5.4,z+5.4,'asphalt',.05)
for x in [-8,7,24.5,37.2]:terrain_rect('Sidewalk',x,x+1.15,-58,58,'walk',.075)
for z in [-55,1,51]:terrain_rect('Cross_walkway',-48,56,z,z+1.25,'walk',.08)
for z in range(-59,60,6):
    if any(abs(z-a)<7 for a in [-48,7,45]):continue
    terrain_rect('Dashed_lane_mark',-.10,.10,z,z+2.3,'white',.067)
    terrain_rect('East_lane_mark',31.35,31.5,z,z+2,'white',.067)
for z in [-40,-1,36]:
    for i in range(9):terrain_rect('Pedestrian_crossing',-5.3+i*1.2,-4.7+i*1.2,z,z+1.8,'white',.073)
# Place three facade variants, each with its own foundation, lawn and small garden.
lots=[(-16,z,math.pi/2,i%3) for i,z in enumerate([-33,-16,22,39])]
lots += [(15.5,z,-math.pi/2,(i+1)%3) for i,z in enumerate([-33,-16,23,38])]
lots += [(47,z,-math.pi/2,(i+2)%3) for i,z in enumerate([-34,-16,23,39])]
lots += [(-34,-28,math.pi/2,1),(-34,25,math.pi/2,2)]
for idx,(x,z,yaw,style) in enumerate(lots):
    y=H(z)+.38
    copies=[]
    for src in templates[style]:
        o=bpy.data.objects.new('Residence_%02d_'%idx+src.name,src.data);bpy.context.collection.objects.link(o);copies.append(o)
    tx(copies,x,y,z,yaw);alltown+=copies
    colliders.append({'kind':'box','position':[x,y+2.7,z],'half':[3.15,2.95,3.8]})
    allbefore=set(bpy.context.scene.objects)
    box('Lot_foundation',(x,y-.7,z),(10,1.5,11.3),'stone',.05)
    terrain_rect('Garden_lawn',x-5.6,x+5.6,z-6.5,z+6.5,'grass_dark',.09)
    # Garden access stays open toward the street.
    for sign in [-1,1]:
        for i in range(5):
            px=x-4.5+i*2.2;pz=z+sign*6.0
            ico('Hedge',(px,H(pz)+.62,pz),(1.25,.62,.58),'leaf_light',1)
    for sign in [-1,1]:pot(x+sign*4.5,H(z+4.4)+.1,z+4.4,True)
    alltown+=since(allbefore)
# Remove unused templates.
for group in templates:
    for o in group:bpy.data.objects.remove(o,do_unlink=True)
def tree(x,z,scale=1):
    y=H(z);before=set(bpy.context.scene.objects)
    cyl('Tree_trunk',(x,y+1.5*scale,z),.18*scale,3*scale,'trunk')
    for dx,dy,dz,s,material in [(0,3.3,0,1.45,'leaf'),(-.85,3.1,.3,1.1,'leaf_light'),(.75,3.5,-.1,1.2,'leaf_light'),(.1,4.25,.1,1.1,'leaf_bright')]:
        ico('Canopy',(x+dx*scale,y+dy*scale,z+dz*scale),(s*scale,s*scale,s*scale),material,2)
    alltown.extend(since(before));colliders.append({'kind':'box','position':[x,y+1.2,z],'half':[.2,1.3,.2]})
for x,z,s in [(-28,-44,1.1),(-28,5,1.0),(-28,45,1.2),(22,-45,.9),(22,7,.85),(21,48,1.0),(42,7,1.2),(57,48,1.2),(-48,-20,1.5),(-45,19,1.4),(-43,40,1.1),(54,-53,1.3),(13,-58,1.0),(39,-58,1.1),(-12,55,1.0),(11,57,1.0),(-37,-57,1.4)]:
    tree(x,z,s)
# A small park and landmark water tower visible beyond the descending street.
before=set(bpy.context.scene.objects)
cyl('Plaza_paving',(0,H(44)+.06,44),7.1,.12,'walk',48)
for a in [0,math.pi/2,math.pi,math.pi*1.5]:
    x=math.cos(a)*5;z=44+math.sin(a)*5
    box('Park_bench_seat',(x,.60,z),(2.5,.14,.60),'wood',.035,rot=a)
    box('Park_bench_back',(x,.99,z+.28),(2.5,.55,.10),'wood',.025,rot=a)
    for dx in [-.9,.9]:box('Bench_leg',(x+dx,.30,z),(.10,.60,.42),'metal')
# Water tower on the corner, built as geometry rather than a background image.
for x in [-2.4,2.4]:
    for z in [-2.4,2.4]:
        beam('Tower_leg',(49+x,0,58+z),(49+x*.8,10.3,58+z*.8),.16,'trim')
beam('Tower_brace',(46.6,1,55.6),(51.4,9.5,55.6),.07,'metal')
beam('Tower_brace',(51.4,1,55.6),(46.6,9.5,55.6),.07,'metal')
cyl('Water_tank',(49,11.2,58),3.3,3.5,'plaster_white',32)
for y in [9.55,12.85]:cyl('Tank_band',(49,y,58),3.36,.14,'blue',32)
cyl('Tank_roof',(49,13.3,58),3.6,1.0,'roof',32,0)
alltown+=since(before)
# Street lamps, utility poles, rubbish bins and parking markings establish scale.
for x,z in [(-7.6,-40),(-7.6,-12),(-7.6,30),(24.8,-26),(24.8,26),(38.8,40)]:
    before=set(bpy.context.scene.objects);y=H(z)
    cyl('Lamp_post',(x,y+2.7,z),.085,5.4,'metal')
    beam('Lamp_arm',(x,y+5.4,z),(x+1.35,y+5.6,z),.075,'metal')
    box('Lamp_head',(x+1.35,y+5.55,z),(.7,.16,.34),'trim',.06)
    alltown+=since(before)
for x,z in [(-8.7,-23),(23,-6),(38,16),(-8.7,14)]:
    before=set(bpy.context.scene.objects);y=H(z)
    box('Waste_bin',(x,y+.55,z),(.65,1.05,.62),'door',.08)
    box('Waste_bin_lid',(x,y+1.12,z),(.75,.12,.72),'metal',.06)
    alltown+=since(before)
# Small physical street props loaded separately at runtime.
for x,z in [(-3,-22),(3,-19),(-2,15),(2,18),(29,21),(33,24),(-3,26),(4,28),(12,6)]:
    prop_spawns.append({'type':'crate','position':[x,H(z)+.55,z]})
for x,z in [(-5,-8),(5,-7),(28,-7),(35,-7),(-4,21),(4,21)]:
    prop_spawns.append({'type':'cone','position':[x,H(z)+.45,z]})
# Cars are static scenic objects with collision; the current test focuses on rolling.
for x,z,color,yaw in [(4.6,-29,'red',0),(28.1,-20,'blue',0),(34.4,30,'yellow',0),(-25,7,'blue',math.pi/2)]:
    before=set(bpy.context.scene.objects);y=H(z)+.18
    box('Car_lower',(0,.6,0),(1.9,.55,3.6),color,.16)
    box('Car_cabin',(0,1.1,-.1),(1.60,.72,1.85),color,.13)
    box('Car_windshield',(0,1.25,.86),(1.44,.43,.045),'glass')
    box('Car_rear_glass',(0,1.25,-1.05),(1.44,.43,.045),'glass')
    for side in [-1,1]:
        box('Car_side_window',(side*.81,1.26,-.10),(.02,.4,1.5),'glass')
        for zz in [-1.1,1.1]:
            a=beam('Tyre',(side*.85,.4,zz),(side*1.04,.4,zz),.35,'rubber')
            beam('Wheel_hub',(side*1.03,.4,zz),(side*1.07,.4,zz),.18,'stone')
        box('Headlight',(side*.65,.65,1.82),(.38,.18,.07),'white')
        box('Taillight',(side*.65,.65,-1.82),(.3,.15,.07),'red')
    box('Car_bumper',(0,.4,1.82),(1.7,.14,.12),'trim')
    parts=since(before);tx(parts,x,y,z,yaw);alltown+=parts
    colliders.append({'kind':'box','position':[x,y+.65,z],'half':[1 if yaw==0 else 1.85,.85,1.85 if yaw==0 else 1]})
# Broad ramp off the boulevard, approachable directly from the slope.
rampverts=[(-2.6,.06,20),(2.6,.06,20),(2.6,1.7,26),(-2.6,1.7,26),(-2.6,.02,26),(2.6,.02,26)]
rampfaces=[(0,1,2,3),(0,3,4),(1,5,2),(3,2,5,4)]
alltown.append(mesh('Timber_jump_ramp',rampverts,rampfaces,'wood'))
colliders.append({'kind':'ramp','vertices':rampverts,'faces':rampfaces})
for z in [21,22,23,24,25]:
    y=.06+(z-20)*1.64/6
    alltown.append(beam('Ramp_grip',(-2.6,y+.02,z),(2.6,y+.02,z),.025,'yellow'))
# Distant terrain forms a continuous town setting and hides the playable boundary.
before=set(bpy.context.scene.objects)
for i in range(26):
    a=i*math.tau/26;x=math.cos(a)*125;z=math.sin(a)*125
    ico('Distant_hill',(x,-4,z),(random.uniform(24,42),random.uniform(13,24),random.uniform(25,38)),'leaf_light' if i%2 else 'grass_dark',2)
alltown+=since(before)
# Deduplicate references from helper functions before joining.
alltown=list(dict.fromkeys(alltown))
merged=merge(alltown,'Town')
export(merged,OUT/'town.glb')
(OUT/'colliders.json').write_text(json.dumps({'colliders':colliders,'props':prop_spawns,'houseCount':len(lots)},separators=(',',':')))
# Export a dynamic wooden crate and traffic cone.
before=set(bpy.context.scene.objects)
box('Crate',(0,0,0),(1,1,1),'wood',.04)
for y in [-.34,0,.34]:
    for z in [-.51,.51]:box('Crate_slats',(0,y,z),(1.04,.12,.05),'plaster')
for x in [-.36,.36]:box('Crate_strap',(x,0,.54),(.10,1.03,.055),'yellow')
crate=merge(since(before),'Crate');export(crate,OUT/'crate.glb')
for o in crate:bpy.data.objects.remove(o,do_unlink=True)
before=set(bpy.context.scene.objects)
box('Cone_base',(0,-.36,0),(.8,.12,.8),'rubber',.04)
cyl('Traffic_cone',(0,0,0),.28,.65,'red',12,.07)
cyl('Reflective_stripe',(0,.08,0),.175,.13,'white',12,.135)
cone=merge(since(before),'Cone');export(cone,OUT/'cone.glb')
for o in cone:bpy.data.objects.remove(o,do_unlink=True)
lighting((95,90,120),(3,0,-5),155)
bpy.context.scene.render.resolution_x=1400;bpy.context.scene.render.resolution_y=1000
bpy.context.scene.render.filepath=str(ART/'town-overview.png')
bpy.ops.wm.save_as_mainfile(filepath=str(ART/'rolling-town.blend'))
bpy.ops.render.render(write_still=True)
triangles=sum(len(o.data.polygons) for o in merged)
(ART/'asset-report.json').write_text(json.dumps({'houses':len(lots),'mergedMeshes':len(merged),'polygons':triangles,'files':{f.name:f.stat().st_size for f in OUT.glob('*')}},indent=2))
print('TOWN_ASSETS_COMPLETE',triangles,len(merged))

