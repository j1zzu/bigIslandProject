# Подготовка и публикация данных в QGIS

## Обязательный pipeline Revit

Сайт и Node.js-сервер не читают `.rvt`, не принимают такие файлы и не выполняют их конвертацию. Поддерживаемая цепочка:

`Revit → экспорт DWG/DXF/IFC/CSV/GeoJSON/Shapefile → QGIS → проверка → WMS/WFS/GeoJSON → Leaflet`

1. Экспортируйте из Revit контуры в DWG/DXF, модель при необходимости в IFC, точки в CSV. GeoJSON или Shapefile допустимы при использовании отдельного экспортного плагина Revit.
2. Импортируйте экспорт в QGIS и назначьте фактический исходный CRS. Назначение CRS не преобразует координаты.
3. Проверьте единицы, project base point/shared coordinates, смещение, поворот, геометрию и контрольные точки.
4. Перепроецируйте проверенный слой в `EPSG:32653` и сохраните в GeoPackage или PostGIS.
5. Добавьте слои под именами из `sample-layers.md` в `big_ussuriysky.qgz`.
6. В свойствах проекта QGIS Server включите WMS/WFS, выберите публикуемые слои и CRS. Открывайте WFS только на чтение, если редактирование не требуется.
7. Для локального GeoJSON экспортируйте копию в `EPSG:4326`; порядок координат — `[долгота, широта]`.

Проверка публикации:

```text
http://192.168.20.20:8080/cgi-bin/qgis_mapserv.fcgi.exe?MAP=world2.qgz&SERVICE=WMS&REQUEST=GetCapabilities
http://192.168.20.20:8080/cgi-bin/qgis_mapserv.fcgi.exe?MAP=world2.qgz&SERVICE=WFS&REQUEST=GetCapabilities
```

После проверки используйте только локальные proxy URL сайта: `/qgis/wms` и `/qgis/wfs`.
