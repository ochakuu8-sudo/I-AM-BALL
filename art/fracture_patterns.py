"""Small, reusable, closed convex wall cells authored before gameplay."""
import random

def clip(poly, nx, ny, distance):
    result = []
    for a, b in zip(poly, poly[1:] + poly[:1]):
        da, db = a[0]*nx+a[1]*ny-distance, b[0]*nx+b[1]*ny-distance
        if da <= 1e-8: result.append(a)
        if (da < 0) != (db < 0):
            t = da/(da-db)
            result.append([a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t])
    return result

def pattern(width, axis):
    rng = random.Random(730 + axis)
    height, depth = 2.55, .24
    rows = [-1.20,-.66,.66,1.20]
    sites = [[(c+.5+rng.uniform(-.23,.23))*width/3-width/2,
              rows[r]+rng.uniform(-.055,.055)] for r in range(4) for c in range(3)]
    cells = []
    for i, a in enumerate(sites):
        polygon = [[-width/2,-height/2],[width/2,-height/2],[width/2,height/2],[-width/2,height/2]]
        for j,b in enumerate(sites):
            if i == j: continue
            polygon = clip(polygon,b[0]-a[0],b[1]-a[1],(b[0]**2+b[1]**2-a[0]**2-a[1]**2)/2)
        cells.append({'polygon':[[round(x,6),round(y,6)] for x,y in polygon]})
    return {'axis':axis,'width':width,'height':height,'depth':depth,'cells':cells}

PATTERNS = {'front':pattern(1.88,0),'side':pattern(1.53,2)}
