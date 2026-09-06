"""Semantic, vertex-coloured Blender chunks for the rolling-town destruction demo."""
import bpy
from mathutils import Vector, Matrix

_cache = {}

def chunk(objects, name, kind='prop', level=0, section=''):
    """One movable mesh per physical part; colours do not add draw calls."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        bpy.context.view_layer.objects.active = o
        for modifier in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    colors = o.data.color_attributes.new(name='Color', type='BYTE_COLOR', domain='CORNER')
    for polygon in o.data.polygons:
        rgba = o.data.materials[polygon.material_index].diffuse_color
        for i in polygon.loop_indices:
            colors.data[i].color = rgba
    material = bpy.data.materials.get('Town_vertex_colour')
    if material is None:
        material = bpy.data.materials.new('Town_vertex_colour')
        material.use_nodes = True
        bsdf = material.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Roughness'].default_value = .78
        vertex = material.node_tree.nodes.new('ShaderNodeVertexColor')
        vertex.layer_name = 'Color'
        material.node_tree.links.new(vertex.outputs['Color'], bsdf.inputs['Base Color'])
    o.data.materials.clear()
    o.data.materials.append(material)
    for polygon in o.data.polygons:
        polygon.material_index = 0
    points = [v.co for v in o.data.vertices]
    center = Vector(tuple((min(v[i] for v in points) + max(v[i] for v in points)) / 2 for i in range(3)))
    o.data.transform(Matrix.Translation(-center))
    o.location = center
    # Identical hedges / repeated parts share a glTF mesh and a GPU instance batch.
    for vertex in o.data.vertices:
        vertex.co = tuple(round(value, 5) for value in vertex.co)
    key = (tuple(tuple(v.co) for v in o.data.vertices),
           tuple(tuple(p.vertices) for p in o.data.polygons),
           tuple(tuple(round(v, 5) for v in c.color) for c in colors.data))
    if key in _cache:
        old = o.data
        o.data = _cache[key]
        bpy.data.meshes.remove(old)
    else:
        _cache[key] = o.data
    o['kind'] = kind
    o['level'] = level
    o['section'] = section
    o.select_set(False)
    return o

def house_chunks(objects, style):
    buckets = {}
    for o in objects:
        if 'chunk' in o:
            key = o['chunk']
            if key.startswith('wall_') and not o.name.startswith('Wall'):
                key = key.replace('wall_', 'detail_', 1)
        elif o.name.startswith('Raised_masonry_foundation'):
            key = 'foundation'
        else:
            # Details stay with the wall, balcony, or roof panel they decorate.
            corners = [o.matrix_world @ Vector(v) for v in o.bound_box]
            c = sum(corners, Vector()) / 8
            x, y, z = c.x, c.z, -c.y
            if y >= 5.10:
                key = 'roof_%d_%d' % (x >= 0, z >= 0)
            elif y >= 2.65 and z > 3.42:
                key = 'balcony_%d' % min(3, max(0, int((x + 3.8) / 1.9)))
            else:
                level = int(y >= 2.75)
                if abs(x) / 3.8 > abs(z) / 3.1:
                    side = 'right' if x > 0 else 'left'
                    part = min(3, max(0, int((z + 3.1) / 1.55)))
                else:
                    side = 'front' if z > 0 else 'back'
                    part = min(3, max(0, int((x + 3.8) / 1.9)))
                key = 'detail_%d_%s_%d' % (level, side, part)
        buckets.setdefault(key, []).append(o)
    result = []
    for key, parts in buckets.items():
        kind = key.split('_')[0]
        level = int(key.split('_')[1]) if kind in ['wall','detail'] else (2 if kind == 'roof' else 1)
        section = '_'.join(key.split('_')[2:4]) if kind in ['wall','detail'] else key
        result.append(chunk(parts, 'House_%d_%s' % (style, key), kind, level, section))
    return result

def register(objects, group, definitions, meshes, strength=14):
    # glTF converts Blender Z-up coordinates to the game's Y-up coordinates.
    conversion = Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0)))
    for o in objects:
        bpy.context.view_layer.update()
        position, rotation, scale = o.matrix_world.decompose()
        q = (conversion @ rotation.to_matrix() @ conversion.transposed()).to_quaternion()
        bounds = [Vector(v) for v in o.bound_box]
        half = [max(abs(v[i]) for v in bounds) * abs(scale[i]) for i in range(3)]
        identity = '%s_%03d' % (group, len(definitions))
        o['pieceId'] = identity
        kind = o.get('kind', 'prop')
        resistance = {'wall': 16, 'roof': 14, 'floor': 14, 'balcony': 10, 'foundation': 12,
                      'hedge': 4, 'pot': 5, 'bin': 7, 'tree': 10,
                      'lamp': 8, 'bench': 8, 'car': 20, 'tower': 18}.get(kind, strength)
        definitions.append({'id': identity, 'group': group, 'kind': kind,
                            'level': o.get('level', 0), 'section': o.get('section', ''),
                            'position': [round(position.x, 5), round(position.z, 5), round(-position.y, 5)],
                            'half': [max(.045, half[0]), max(.045, half[2]), max(.045, half[1])],
                            'rotation': [q.x, q.y, q.z, q.w], 'strength': resistance})
        if kind == 'wall':
            definitions[-1]['fracture'] = 'side' if o['section'].startswith(('left','right')) else 'front'
        meshes.append(o)
